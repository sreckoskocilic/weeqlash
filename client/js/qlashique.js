// ============================================================
// QLASHIQUE MODULE (1v1 trivia duel)
// ============================================================

import { el, qEl, showScreen, showError, sanitize, getPlayerName } from './dom.js';
import { getSocket } from './socket.js';
import { renderQuestion, makeCountdownRing } from './question-render.js';
import { QLAS_DEFAULT_HP, QLAS_HP_OPTIONS } from './constants.js';

const QLAS_THEMES = {
  terminal: {
    'game-bg': '#020c02',
    'game-bg-2': '#071007',
    'game-bg-3': '#041004',
    'game-border': '#0d2e0d',
    'game-border-2': '#1c4d1c',
    'game-text': '#88ff88',
    'game-accent': '#00ff41',
    'game-accent-rgb': '0, 255, 65',
    'game-accent-2': '#00b8ff',
    'game-key': '#ffe600',
  },
  crimson: {
    'game-bg': '#0a0406',
    'game-bg-2': '#120810',
    'game-bg-3': '#0e060a',
    'game-border': '#2e0d1a',
    'game-border-2': '#4d1c2e',
    'game-text': '#ff8888',
    'game-accent': '#ff2244',
    'game-accent-rgb': '255, 34, 68',
    'game-accent-2': '#ff8800',
    'game-key': '#ffe600',
  },
  cyber: {
    'game-bg': '#020810',
    'game-bg-2': '#071220',
    'game-bg-3': '#041018',
    'game-border': '#0d2040',
    'game-border-2': '#1c3d6d',
    'game-text': '#88ccff',
    'game-accent': '#00d4ff',
    'game-accent-rgb': '0, 212, 255',
    'game-accent-2': '#ff44aa',
    'game-key': '#ffe600',
  },
  amber: {
    'game-bg': '#0c0a02',
    'game-bg-2': '#141006',
    'game-bg-3': '#100e04',
    'game-border': '#2e2a0d',
    'game-border-2': '#4d441c',
    'game-text': '#eedd88',
    'game-accent': '#ffb000',
    'game-accent-rgb': '255, 176, 0',
    'game-accent-2': '#ff6644',
    'game-key': '#ffe600',
  },
  synthwave: {
    'game-bg': '#0a020c',
    'game-bg-2': '#100718',
    'game-bg-3': '#0c0412',
    'game-border': '#2a0d3e',
    'game-border-2': '#441c6d',
    'game-text': '#cc88ff',
    'game-accent': '#aa44ff',
    'game-accent-rgb': '170, 68, 255',
    'game-accent-2': '#ff44aa',
    'game-key': '#ffe600',
  },
  hiberbee: {
    'game-bg': '#171615',
    'game-bg-2': '#222120',
    'game-bg-3': '#1e1e1e',
    'game-border': '#373635',
    'game-border-2': '#525150',
    'game-text': '#cfcecd',
    'game-accent': '#5efbef',
    'game-accent-rgb': '94, 251, 239',
    'game-accent-2': '#ee7762',
    'game-key': '#ffd866',
  },
};
const QLAS_THEME_KEY = 'weeqlash.qlasTheme';

function qlasApplyTheme(name) {
  const t = QLAS_THEMES[name];
  if (!t) {
    return;
  }
  const screen = document.getElementById('screen-qlashique');
  for (const [k, v] of Object.entries(t)) {
    screen.style.setProperty('--' + k, v);
  }
}

function qlasGetStoredTheme() {
  try {
    const v = localStorage.getItem(QLAS_THEME_KEY);
    return QLAS_THEMES[v] ? v : 'terminal';
  } catch {
    return 'terminal';
  }
}

// State
let qlasCode = null;
let qlasMyIdx = null;
let qlasIsHost = false;
let qlasPlayers = [{ name: '' }, { name: '' }];
let qlasMaxHp = QLAS_DEFAULT_HP;
let qlasHp = [QLAS_DEFAULT_HP, QLAS_DEFAULT_HP];
let qlasScore = 0;
let qlasCurrentQ = null;
let qlasTimerTotal = 5;
let qlasRing = null; // CountdownRing, lazily created on first qlasStartTimer
let qlasGuessingActive = false;
let qlasLastAnswerIdx = -1;
let qlasLiveHistory = [];
let qlasMatchStart = null;
let qlasStreak = [0, 0];
// Per-turn UX bookkeeping
let qlasNextQTimeout = null; // delay next question render to show answer color
let qlasActivePlayerIdx = null; // who's currently taking the turn
let qlasLastScoreByPlayer = [0, 0]; // remembered after each answer; classified at turn_end
let qlasTurnAnswerCount = [0, 0]; // # answers given this turn (for recap line)
let qlasTurnCorrectCount = [0, 0];

const QLAS_TIMER_RING_CIRC = 175.93; // 2 * PI * r where r=28

// --- UI helpers ---

export function qlasShowPhase(phase) {
  ['qlas-phase-waiting', 'qlas-phase-combat', 'qlas-phase-gameover'].forEach((id) => {
    qEl(id).style.display = 'none';
  });
  qEl('qlas-phase-' + phase).style.display = '';
}

export function qlasSetHP(playerIdx, hp) {
  hp = Math.max(0, Math.min(qlasMaxHp, hp));
  qlasHp[playerIdx] = hp;
  qEl('qlas-p' + playerIdx + 'hp').textContent = hp;
  const bar = qEl('qlas-p' + playerIdx + 'hpbar');
  bar.style.width = (hp / qlasMaxHp) * 100 + '%';
  const pct = hp / qlasMaxHp;
  bar.classList.toggle('hp-low', pct > 0.15 && pct <= 0.35);
  bar.classList.toggle('hp-critical', pct > 0 && pct <= 0.15);
}

export function qlasSetScore(score) {
  qlasScore = score;
  const scoreEl = qEl('qlas-turn-score');
  if (scoreEl) {
    scoreEl.textContent = score > 0 ? '+' + score : score === 0 ? '0' : '' + score;
  }
  qEl('qlas-heal-val').textContent = '+2 HP';
}

export function qlasFlash(playerIdx, type) {
  const bar = qEl('qlas-p' + playerIdx + 'bar');
  if (type === 'dmg') {
    bar.classList.add('qlas-take-dmg');
    const layout = document.querySelector('.qlas-combat-layout');
    if (layout) {
      layout.classList.remove('screen-shake');
      void layout.offsetWidth;
      layout.classList.add('screen-shake');
      setTimeout(() => layout.classList.remove('screen-shake'), 350);
    }
  } else {
    bar.classList.add('qlas-take-heal');
  }
  setTimeout(() => bar.classList.remove('qlas-take-dmg', 'qlas-take-heal'), 700);
}

// Spawn a floating "−4" / "+2" number above a player's pbar; auto-removes after anim.
function qlasFloatNum(playerIdx, delta, type) {
  const host = qEl('qlas-p' + playerIdx + 'float');
  if (!host || !delta) {
    return;
  }
  const span = document.createElement('span');
  span.className = 'qlas-floating-num';
  if (type === 'dmg') {
    span.classList.add('dmg');
  } else if (type === 'heal') {
    span.classList.add('heal');
  }
  const sign = delta > 0 ? '+' : '';
  span.textContent = sign + delta;
  host.appendChild(span);
  setTimeout(() => span.remove(), 1300);
}

// Spawn a small +1 / −1 next to the running score; auto-removes after anim.
function qlasScoreMiniFlash(delta) {
  if (!delta) {
    return;
  }
  const host = qEl('qlas-turn-score');
  if (!host) {
    return;
  }
  const span = document.createElement('span');
  span.className = 'qlas-score-mini';
  if (delta > 0) {
    span.classList.add('up');
  } else {
    span.classList.add('down');
  }
  span.textContent = (delta > 0 ? '+' : '') + delta;
  host.appendChild(span);
  setTimeout(() => span.remove(), 1000);
}

// Push one outcome dot for the just-ended turn.
function qlasPushHistoryDot(playerIdx, score) {
  const host = qEl('qlas-history-dots');
  if (!host) {
    return;
  }
  const dot = document.createElement('span');
  dot.className = 'hd';
  if (score > 0) {
    dot.classList.add('win');
  } else if (score < 0) {
    dot.classList.add('loss');
  } else {
    dot.classList.add('zero');
  }
  dot.title =
    'T' +
    (host.childElementCount + 1) +
    ' · ' +
    (qlasPlayers[playerIdx]?.name || 'P' + (playerIdx + 1)) +
    ' · ' +
    (score > 0 ? '+' : '') +
    score;
  host.appendChild(dot);
}

function qlasResetHistoryDots() {
  const host = qEl('qlas-history-dots');
  if (host) {
    host.innerHTML = '';
  }
}

// Show / update / hide the streak badge for a player.
function qlasUpdateStreakBadge(playerIdx) {
  const badge = qEl('qlas-p' + playerIdx + 'streak');
  if (!badge) {
    return;
  }
  const num = badge.querySelector('.num');
  const n = qlasStreak[playerIdx] || 0;
  if (n >= 2) {
    if (num) {
      num.textContent = String(n);
    }
    badge.classList.add('show');
  } else {
    badge.classList.remove('show');
  }
}

export function qlasRenderQuestion(q, idx) {
  if (!qlasMatchStart) {
    qlasMatchStart = Date.now();
  }
  qlasCurrentQ = q;
  renderQuestion(
    {
      questionEl: qEl('qlas-question'),
      optionsEl: qEl('qlas-options'),
      flashEl: qEl('qlas-flash'),
    },
    q,
    idx,
    qlasSubmitAnswer,
  );
}

// Flash banner after answer evaluation
function qlasShowFlash(correct, delta) {
  const flashEl = qEl('qlas-flash');
  if (!flashEl) {
    return;
  }
  const sign = delta > 0 ? '+' : '';
  const deltaStr = delta ? '   ' + sign + delta : '';
  flashEl.textContent = '> ' + (correct ? 'CORRECT' : 'INCORRECT') + deltaStr;
  flashEl.className = 'qlas-flash show ' + (correct ? 'hit' : 'miss');
  clearTimeout(qlasShowFlash._t);
  qlasShowFlash._t = setTimeout(() => flashEl.classList.remove('show'), 900);
}

// Append a transient log entry (combo streaks, events)
function qlasLogEntry(text) {
  const log = qEl('qlas-log');
  if (!log) {
    return;
  }
  const entry = document.createElement('div');
  entry.className = 'qlas-log-entry';
  entry.textContent = text;
  log.appendChild(entry);
  setTimeout(() => entry.remove(), 2500);
}

export function qlasStartTimer(seconds) {
  qlasTimerTotal = seconds;
  if (!qlasRing) {
    qlasRing = makeCountdownRing({
      ringEl: qEl('qlas-turn-timer'),
      labelEl: qEl('qlas-timer-ring-label'),
      progressEl: qEl('qlas-timer-ring-progress'),
      ringCirc: QLAS_TIMER_RING_CIRC,
    });
  }
  qlasRing.start(seconds);
}

export function qlasStopTimer() {
  qlasRing?.stop();
}

export function qlasRenderPlayerInfo() {
  [0, 1].forEach((i) => {
    const p = qlasPlayers[i];
    const textEl = qEl('qlas-p' + i + 'name-text');
    if (textEl) {
      textEl.textContent = p.name || 'Player ' + (i + 1);
    }
  });
}

function qlasSetScoreOther(playerIdx, score) {
  if (playerIdx === qlasMyIdx) {
    return;
  }
  const scoreEl2 = qEl('qlas-turn-score');
  if (!scoreEl2) {
    return;
  }
  if (score === null) {
    scoreEl2.textContent = '0';
    return;
  }
  scoreEl2.textContent = score > 0 ? '+' + score : '' + score;
}

// --- Reconnect restore ---

export function qlasRestoreFromReconnect(res) {
  qlasMyIdx = res.myIdx;
  qlasCode = res.code;
  qlasHp = res.hp;
  qlasScore = res.currentScore || 0;
  qlasPlayers = res.players.map((p) => ({ name: p.name || '' }));

  showScreen('screen-qlashique');

  const QLAS_PHASE_GAMEOVER = 'game_over';
  const QLAS_PHASE_OUTCOME = 'outcome';
  const QLAS_PHASE_GUESSING = 'guessing';

  if (res.phase === QLAS_PHASE_GAMEOVER) {
    qlasShowPhase('gameover');
    return;
  }

  qlasShowPhase('combat');
  qlasRenderPlayerInfo();
  qlasSetHP(0, res.hp[0]);
  qlasSetHP(1, res.hp[1]);

  const isMyTurn = res.currentPlayerIdx === qlasMyIdx;

  if (res.phase === QLAS_PHASE_OUTCOME) {
    if (isMyTurn) {
      qEl('btn-qlas-end').style.display = '';
      qEl('btn-qlas-end').disabled = false;
      qEl('qlas-action-row').style.display = '';
      if (qlasScore >= 2) {
        qEl('btn-qlas-heal').style.display = '';
        qEl('btn-qlas-heal').disabled = false;
      }
    }
    return;
  }

  if (res.phase === QLAS_PHASE_GUESSING && isMyTurn && res.currentQuestion) {
    qlasGuessingActive = true;
    qlasTimerTotal = res.timerSeconds;
    const remaining = Math.max(1, res.timerSeconds - res.timerElapsed);
    qEl('qlas-decision-panel').style.display = 'none';
    qEl('qlas-qpanel').style.display = '';
    qEl('qlas-action-row').style.display = '';
    qEl('btn-qlas-end').disabled = false;
    qlasRenderQuestion(res.currentQuestion, 0);
    qlasStartTimer(remaining);
    return;
  }

  if (isMyTurn) {
    qEl('qlas-decision-panel').style.display = '';
  } else {
    qEl('qlas-decision-panel').style.display = 'none';
  }
}

// --- Guessing phase ---

export function qlasStartGuessing() {
  qlasGuessingActive = true;
  qEl('qlas-decision-panel').style.display = 'none';
  qEl('qlas-action-row').style.display = '';
  qEl('btn-qlas-stop').style.display = '';
  qEl('btn-qlas-stop').disabled = false;
  qEl('btn-qlas-end').style.display = 'none';
  qEl('btn-qlas-heal').style.display = 'none';
  const socket = getSocket();
  socket.emit('qlashique:start_guessing', { code: qlasCode }, (res) => {
    if (res?.error) {
      qlasGuessingActive = false;
      qEl('qlas-decision-panel').style.display = '';
      qEl('qlas-action-row').style.display = 'none';
      qEl('btn-qlas-stop').style.display = 'none';
      console.error('start_guessing failed:', res.error);
    }
  });
}

export function qlasSubmitAnswer(answerIdx) {
  if (!qlasGuessingActive || !qlasCurrentQ) {
    return;
  }
  qlasLastAnswerIdx = answerIdx;
  document.querySelectorAll('.qlas-opt').forEach((b) => (b.disabled = true));
  const socket = getSocket();
  socket.emit('qlashique:answer', { code: qlasCode, answerIdx }, () => {});
}

export function qlasStopAttack() {
  if (!qlasGuessingActive) {
    return;
  }
  qlasGuessingActive = false;
  qEl('btn-qlas-stop').disabled = true;
  document.querySelectorAll('.qlas-opt').forEach((b) => (b.disabled = true));
  const socket = getSocket();
  socket.emit('qlashique:stop_attack', { code: qlasCode }, (res) => {
    if (res?.error) {
      return;
    }
    qEl('btn-qlas-stop').style.display = 'none';
    qEl('btn-qlas-end').style.display = '';
    qEl('btn-qlas-end').disabled = false;
    if (qlasScore >= 2) {
      qEl('btn-qlas-heal').style.display = '';
      qEl('btn-qlas-heal').disabled = false;
    }
  });
}

export function qlasEndTurn() {
  qEl('btn-qlas-end').disabled = true;
  qEl('btn-qlas-heal').disabled = true;
  const socket = getSocket();
  socket.emit('qlashique:end_turn', { code: qlasCode, choice: 'attack' }, () => {});
}

export function qlasHeal() {
  qEl('btn-qlas-end').disabled = true;
  qEl('btn-qlas-heal').disabled = true;
  const socket = getSocket();
  socket.emit('qlashique:end_turn', { code: qlasCode, choice: 'heal' }, () => {});
}

// --- Recap ---

function qlasGroupHistoryByTurn(history) {
  const groups = [];
  for (const entry of history) {
    const last = groups[groups.length - 1];
    if (last && last.turn === entry.turn && last.playerIdx === entry.playerIdx) {
      last.entries.push(entry);
    } else {
      groups.push({ turn: entry.turn, playerIdx: entry.playerIdx, entries: [entry] });
    }
  }
  return groups;
}

function qlasBuildRecapCard(group) {
  const playerName = qlasPlayers[group.playerIdx]?.name || 'Player ' + (group.playerIdx + 1);
  const playerClass = group.playerIdx === 0 ? 'qlas-recap-p0' : 'qlas-recap-p1';
  const lastEntry = group.entries[group.entries.length - 1];
  const card = document.createElement('div');
  card.className = 'qlas-recap-card p' + group.playerIdx + (lastEntry.correct ? '' : ' wrong');
  const scoreSign = lastEntry.scoreAfter > 0 ? '+' : '';
  let entriesHtml = '';
  for (const e of group.entries) {
    const pickedLabel =
      typeof e.answerIdx === 'number' && e.answerIdx >= 0
        ? 'ABCD'[e.answerIdx] + '. ' + sanitize(e.opts?.[e.answerIdx] ?? '?')
        : '—';
    entriesHtml +=
      '<div class="qlas-recap-entry">' +
      '<div class="qlas-recap-q">' +
      (e.category ? '<span class="qlas-recap-cat">' + sanitize(e.category) + '</span> ' : '') +
      sanitize(e.q || '') +
      '</div>' +
      '<div class="qlas-recap-ans">' +
      '<span class="' +
      (e.correct ? 'ok' : 'bad') +
      '">' +
      (e.correct ? '✓ ' : '✗ picked ') +
      pickedLabel +
      '</span>' +
      '</div>' +
      '</div>';
  }
  card.innerHTML =
    '<div class="qlas-recap-head">' +
    '<span class="qlas-recap-turn">T' +
    Number(group.turn) +
    '</span>' +
    '<span class="' +
    playerClass +
    '">' +
    sanitize(playerName) +
    '</span>' +
    '<span class="qlas-recap-score">' +
    scoreSign +
    Number(lastEntry.scoreAfter) +
    '</span>' +
    '</div>' +
    entriesHtml;
  return card;
}

function qlasPopulateRecap(containerId, history) {
  const container = qEl(containerId);
  if (!container) {
    return;
  }
  container.innerHTML = '';
  if (!history.length) {
    container.innerHTML = '<div class="qlas-recap-empty">no rounds played yet</div>';
    return;
  }
  for (const group of qlasGroupHistoryByTurn(history)) {
    container.appendChild(qlasBuildRecapCard(group));
  }
}

function qlasRenderRecap(history) {
  const container = qEl('qlas-recap');
  const toggle = qEl('qlas-recap-toggle');
  if (!container || !toggle) {
    return;
  }
  container.innerHTML = '';
  container.style.display = 'none';
  toggle.textContent = '[ show recap ]';
  if (!history.length) {
    toggle.style.display = 'none';
    return;
  }
  toggle.style.display = '';
  for (const group of qlasGroupHistoryByTurn(history)) {
    container.appendChild(qlasBuildRecapCard(group));
  }
}

// --- Initialize Qlashique handlers ---

function qlasToggleRecap() {
  const container = qEl('qlas-recap');
  const toggle = qEl('qlas-recap-toggle');
  if (!container || !toggle) {
    return;
  }
  const hidden = container.style.display === 'none';
  container.style.display = hidden ? 'flex' : 'none';
  toggle.textContent = hidden ? '[ hide recap ]' : '[ show recap ]';
}

function qlasOpenLiveRecap() {
  qlasPopulateRecap('qlas-recap-live', qlasLiveHistory);
  qEl('qlas-recap-modal')?.classList.add('show');
}

function qlasCloseLiveRecap() {
  qEl('qlas-recap-modal')?.classList.remove('show');
}

export function initQlashique(socket) {
  // Theme picker
  const storedTheme = qlasGetStoredTheme();
  qlasApplyTheme(storedTheme);
  const themePicker = document.getElementById('qlas-theme-picker');
  if (themePicker) {
    themePicker.value = storedTheme;
    themePicker.addEventListener('change', function () {
      qlasApplyTheme(this.value);
      try {
        localStorage.setItem(QLAS_THEME_KEY, this.value);
      } catch {
        /* ok */
      }
    });
  }

  qEl('qlas-btn-copy-code').addEventListener('click', () => {
    navigator.clipboard.writeText(qEl('qlas-code-val').textContent);
  });
  qEl('qlas-recap-live-btn').addEventListener('click', qlasOpenLiveRecap);
  qEl('btn-qlas-stop').addEventListener('click', qlasStopAttack);
  qEl('btn-qlas-end').addEventListener('click', qlasEndTurn);
  qEl('btn-qlas-heal').addEventListener('click', qlasHeal);
  qEl('btn-qlas-attack').addEventListener('click', qlasStartGuessing);
  qEl('qlas-recap-toggle').addEventListener('click', qlasToggleRecap);
  qEl('qlas-recap-modal-close').addEventListener('click', qlasCloseLiveRecap);
  qEl('qlas-recap-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      qlasCloseLiveRecap();
    }
  });
  qEl('btn-qlas-playagain').addEventListener('click', () => location.reload());

  // Socket events
  socket.on('room:player_joined', ({ players }) => {
    if (qlasCode) {
      players.forEach((p, i) => {
        qlasPlayers[i].name = p.name || '';
      });
    }
  });

  socket.on('room:full', ({ maxHp }) => {
    if (maxHp !== undefined) {
      qlasMaxHp = maxHp;
      qlasHp = [maxHp, maxHp];
    }
  });

  socket.on('qlashique:turn_start', ({ playerIdx, timerSeconds, maxHp }) => {
    if (maxHp !== undefined) {
      qlasMaxHp = maxHp;
    }
    qlasStopTimer();
    qlasScore = 0;
    qlasActivePlayerIdx = playerIdx;
    qlasTurnAnswerCount = [0, 0];
    qlasTurnCorrectCount = [0, 0];
    qlasGuessingActive = false;
    qEl('qlas-brand')?.style.setProperty('display', 'none');
    qEl('qlas-qpanel').style.display = 'none';
    qEl('qlas-action-row').style.display = 'none';
    qEl('btn-qlas-stop').style.display = 'none';
    qEl('btn-qlas-end').style.display = 'none';
    qEl('btn-qlas-heal').style.display = 'none';
    qEl('qlas-waiting-panel').style.display = 'none';
    qEl('qlas-phase-waiting').style.display = 'none';
    qEl('qlas-phase-combat').style.display = '';
    qEl('qlas-phase-gameover').style.display = 'none';
    showScreen('screen-qlashique');

    qlasRenderPlayerInfo();
    qlasSetHP(0, qlasHp[0]);
    qlasSetHP(1, qlasHp[1]);
    [0, 1].forEach((i) => {
      qlasSetScoreOther(i, null);
    });
    qlasSetScore(0);

    qEl('qlas-p0bar').classList.toggle('active-turn', playerIdx === 0);
    qEl('qlas-p1bar').classList.toggle('active-turn', playerIdx === 1);

    // New turn → clear thinking + streak indicators; will re-show on first question.
    [0, 1].forEach((i) => {
      qEl('qlas-p' + i + 'thinking')?.classList.remove('active');
      qlasStreak[i] = 0;
      qlasUpdateStreakBadge(i);
    });

    const isMyTurn = playerIdx === qlasMyIdx;
    const turnPlayerName = qlasPlayers[playerIdx].name || 'Player ' + (playerIdx + 1);
    // Active player color follows the global game theme via CSS vars.
    const activeColor = playerIdx === 0 ? 'var(--game-accent)' : 'var(--game-accent-2)';
    qEl('qlas-turn-bar').style.setProperty('--active-pc', activeColor);
    qEl('qlas-turn-name').textContent = turnPlayerName;
    qEl('qlas-turn-timer').className = 'qlas-timer-ring';
    qEl('qlas-timer-ring-label').textContent = timerSeconds + 's';
    const progress0 = qEl('qlas-timer-ring-progress');
    if (progress0) {
      progress0.setAttribute('stroke-dashoffset', '0');
    }
    qEl('qlas-turn-score').textContent = '0';

    if (isMyTurn) {
      qEl('qlas-decision-panel').style.display = '';
      qlasTimerTotal = timerSeconds;
    } else {
      qEl('qlas-decision-panel').style.display = 'none';
    }
  });

  socket.on('qlashique:question', ({ question, questionIdx, activePlayerIdx }) => {
    const isMyTurn = activePlayerIdx === qlasMyIdx;
    qlasActivePlayerIdx = activePlayerIdx;
    clearTimeout(qlasNextQTimeout);
    // Show "guessing..." on the opponent's pbar while they answer.
    [0, 1].forEach((i) => {
      const t = qEl('qlas-p' + i + 'thinking');
      if (!t) {
        return;
      }
      if (i === activePlayerIdx && i !== qlasMyIdx) {
        t.classList.add('active');
      } else {
        t.classList.remove('active');
      }
    });
    if (questionIdx === 0) {
      qlasGuessingActive = isMyTurn;
      qEl('qlas-decision-panel').style.display = 'none';
      qEl('qlas-action-row').style.display = isMyTurn ? '' : 'none';
      qEl('btn-qlas-stop').style.display = isMyTurn ? '' : 'none';
      qEl('btn-qlas-end').style.display = 'none';
      qEl('btn-qlas-heal').style.display = 'none';
      qEl('qlas-qpanel').style.display = '';
      qEl('qlas-qpanel').style.opacity = '1.0';
      if (isMyTurn) {
        qlasStartTimer(qlasTimerTotal);
      }
      qlasRenderQuestion(question, questionIdx);
      if (!isMyTurn) {
        document.querySelectorAll('.qlas-opt').forEach((b) => (b.disabled = true));
      }
    } else if (isMyTurn) {
      qlasNextQTimeout = setTimeout(() => {
        document.querySelectorAll('.qlas-opt').forEach((b) => (b.disabled = false));
        qlasRenderQuestion(question, questionIdx);
      }, 600);
    } else {
      qlasRenderQuestion(question, questionIdx);
      document.querySelectorAll('.qlas-opt').forEach((b) => (b.disabled = true));
    }
  });

  socket.on(
    'qlashique:answer_result',
    ({ correct, newScore, playerIdx, answerIdx, category, q, opts, turn }) => {
      const prevScore = playerIdx === qlasMyIdx ? qlasScore : qlasLastScoreByPlayer[playerIdx] || 0;
      const delta = newScore - prevScore;
      if (playerIdx === qlasMyIdx) {
        const btns = document.querySelectorAll('.qlas-opt');
        if (qlasLastAnswerIdx >= 0 && btns[qlasLastAnswerIdx]) {
          btns[qlasLastAnswerIdx].classList.add(correct ? 'correct' : 'wrong');
        }
        qlasSetScore(newScore);
        qlasShowFlash(correct, delta);
        qlasScoreMiniFlash(delta);
      } else {
        qlasSetScoreOther(playerIdx, newScore);
      }
      qlasLastScoreByPlayer[playerIdx] = newScore;
      qlasTurnAnswerCount[playerIdx] = (qlasTurnAnswerCount[playerIdx] || 0) + 1;
      if (correct) {
        qlasTurnCorrectCount[playerIdx] = (qlasTurnCorrectCount[playerIdx] || 0) + 1;
      }
      // Streak tracking → combo log + visible badge on player's pbar
      if (correct) {
        qlasStreak[playerIdx] = (qlasStreak[playerIdx] || 0) + 1;
        if (qlasStreak[playerIdx] >= 2) {
          const name = qlasPlayers[playerIdx]?.name || 'P' + (playerIdx + 1);
          qlasLogEntry('> COMBO x' + qlasStreak[playerIdx] + ' — ' + name.toUpperCase());
        }
      } else {
        qlasStreak[playerIdx] = 0;
      }
      qlasUpdateStreakBadge(playerIdx);
      const pbar = qEl('qlas-p' + playerIdx + 'bar');
      if (pbar) {
        pbar.classList.toggle('streak-high', qlasStreak[playerIdx] >= 4);
      }
      if (typeof q === 'string') {
        qlasLiveHistory.push({
          turn,
          playerIdx,
          category,
          q,
          opts,
          answerIdx,
          correct,
          scoreAfter: newScore,
        });
      }
    },
  );

  socket.on('qlashique:turn_end', () => {
    clearTimeout(qlasNextQTimeout);
    qlasStopTimer();
    qlasGuessingActive = false;
    qEl('qlas-action-row').style.display = 'none';
    qEl('qlas-qpanel').style.opacity = '0.4';
    // Hide thinking indicators (turn over, no one is guessing).
    [0, 1].forEach((i) => qEl('qlas-p' + i + 'thinking')?.classList.remove('active'));

    // Push a history dot + a brief recap line into the log.
    const idx = qlasActivePlayerIdx;
    if (idx === 0 || idx === 1) {
      const finalScore = qlasLastScoreByPlayer[idx] || 0;
      qlasPushHistoryDot(idx, finalScore);
      const name = qlasPlayers[idx]?.name || 'P' + (idx + 1);
      const correct = qlasTurnCorrectCount[idx] || 0;
      const total = qlasTurnAnswerCount[idx] || 0;
      const sign = finalScore > 0 ? '+' : '';
      qlasLogEntry(
        '> ' + name.toUpperCase() + ' · ' + correct + '/' + total + ' · ' + sign + finalScore,
      );
      // Reset that player's per-turn counters so next turn starts clean.
      qlasLastScoreByPlayer[idx] = 0;
    }
  });

  socket.on('qlashique:attack_stopped', ({ score }) => {
    clearTimeout(qlasNextQTimeout);
    qlasGuessingActive = false;
    document.querySelectorAll('.qlas-opt').forEach((b) => (b.disabled = true));
    qEl('btn-qlas-stop').style.display = 'none';
    qEl('btn-qlas-end').style.display = '';
    qEl('btn-qlas-end').disabled = false;
    if (score >= 2) {
      qEl('btn-qlas-heal').style.display = '';
      qEl('btn-qlas-heal').disabled = false;
    }
  });

  socket.on('qlashique:timer_expired', () => {
    clearTimeout(qlasNextQTimeout);
    if (!qlasGuessingActive) {
      return;
    }
    qlasStopTimer();
    qlasGuessingActive = false;
    document.querySelectorAll('.qlas-opt').forEach((b) => (b.disabled = true));
    qEl('btn-qlas-stop').style.display = 'none';
    qEl('btn-qlas-end').style.display = '';
    qEl('btn-qlas-end').disabled = false;
    if (qlasScore >= 2) {
      qEl('btn-qlas-heal').style.display = '';
      qEl('btn-qlas-heal').disabled = false;
    }
  });

  socket.on('qlashique:hp_update', ({ p0hp, p1hp }) => {
    const prev0 = qlasHp[0];
    const prev1 = qlasHp[1];
    const delta0 = p0hp - prev0;
    const delta1 = p1hp - prev1;
    qlasSetHP(0, p0hp);
    qlasSetHP(1, p1hp);
    if (delta0 < 0) {
      qlasFlash(0, 'dmg');
      qlasFloatNum(0, delta0, 'dmg');
    } else if (delta0 > 0) {
      qlasFlash(0, 'heal');
      qlasFloatNum(0, delta0, 'heal');
    }
    if (delta1 < 0) {
      qlasFlash(1, 'dmg');
      qlasFloatNum(1, delta1, 'dmg');
    } else if (delta1 > 0) {
      qlasFlash(1, 'heal');
      qlasFloatNum(1, delta1, 'heal');
    }
  });

  socket.on('qlashique:game_over', ({ winnerIdx, reason, history }) => {
    clearTimeout(qlasNextQTimeout);
    qlasStopTimer();
    qEl('qlas-phase-combat').style.display = 'none';
    qEl('qlas-phase-gameover').style.display = '';
    qEl('qlas-brand')?.style.setProperty('display', '');
    const isWinner = winnerIdx === qlasMyIdx;
    const winnerName = qlasPlayers[winnerIdx]?.name || 'Player ' + (winnerIdx + 1);
    qEl('qlas-winner-text').textContent = isWinner ? '🏆 YOU WIN!' : winnerName + ' WINS';
    const reasonMap = {
      hp: 'Player defeated (0 HP)',
      self_destruct: 'self-destruct',
      disconnect: 'disconnect',
    };
    qEl('qlas-winner-reason').textContent = (reasonMap[reason] || reason || '—').toUpperCase();

    const durEl = qEl('qlas-go-duration');
    if (durEl && qlasMatchStart) {
      const s = Math.round((Date.now() - qlasMatchStart) / 1000);
      const mm = Math.floor(s / 60);
      const ss = s % 60;
      durEl.textContent = String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
    }

    const histArr = Array.isArray(history) ? history : qlasLiveHistory;
    const myAnswers = histArr.filter(
      (h) => h && h.playerIdx === qlasMyIdx && typeof h.correct === 'boolean',
    );
    const accEl = qEl('qlas-go-accuracy');
    if (accEl) {
      if (myAnswers.length) {
        const cnt = myAnswers.filter((h) => h.correct).length;
        const pct = Math.round((cnt / myAnswers.length) * 100);
        accEl.textContent = cnt + '/' + myAnswers.length + '  ' + pct + '%';
      } else {
        accEl.textContent = '—';
      }
    }

    qlasRenderRecap(histArr);

    // Reset for next match
    qlasMatchStart = null;
    qlasStreak = [0, 0];
  });

  function qlasResetForNewMatch() {
    clearTimeout(qlasNextQTimeout);
    qlasPlayers = [{ name: '' }, { name: '' }];
    qlasHp = [qlasMaxHp, qlasMaxHp];
    qlasScore = 0;

    qlasGuessingActive = false;
    qlasLiveHistory = [];
    qlasActivePlayerIdx = null;
    qlasLastScoreByPlayer = [0, 0];
    qlasTurnAnswerCount = [0, 0];
    qlasTurnCorrectCount = [0, 0];
    qlasStreak = [0, 0];
    qlasResetHistoryDots();
    [0, 1].forEach((i) => {
      qEl('qlas-p' + i + 'thinking')?.classList.remove('active');
      qEl('qlas-p' + i + 'streak')?.classList.remove('show');
    });
  }

  const hpContainer = el('qlas-hp-selector');
  const label = document.createElement('span');
  label.className = 'qlas-hp-label';
  label.textContent = 'HP';
  hpContainer.appendChild(label);
  for (const hp of QLAS_HP_OPTIONS) {
    const btn = document.createElement('button');
    btn.className = 'qlas-hp-opt' + (hp === QLAS_DEFAULT_HP ? ' selected' : '');
    btn.type = 'button';
    btn.dataset.hp = hp;
    btn.textContent = hp;
    btn.addEventListener('click', () => {
      hpContainer.querySelectorAll('.qlas-hp-opt').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
    hpContainer.appendChild(btn);
  }

  el('btn-qlas-create').addEventListener('click', () => {
    qlasIsHost = true;
    qlasCode = null;
    const hpSel = document.querySelector('.qlas-hp-opt.selected');
    qlasMaxHp = hpSel ? Number(hpSel.dataset.hp) : QLAS_DEFAULT_HP;
    qlasResetForNewMatch();

    const playerName = getPlayerName();
    showScreen('screen-qlashique');
    qlasShowPhase('waiting');
    qEl('qlas-waiting-panel').style.display = '';

    socket.emit('qlashique:create_room', { playerName, hp: qlasMaxHp }, (res) => {
      if (res.error) {
        showError(res.error);
        return;
      }
      qlasCode = res.code;

      qlasMyIdx = 0;
      qlasPlayers[0].name = playerName;
      qEl('qlas-waiting-label').textContent = `HP ${qlasMaxHp} · Waiting for opponent…`;
      qEl('qlas-code-row').style.display = '';
      qEl('qlas-code-val').textContent = res.code;
    });
  });

  el('btn-qlas-start').addEventListener('click', () => {
    const codeInput = el('qlas-join-code').value.trim().toUpperCase();
    if (codeInput.length !== 5) {
      showError('Enter a 5-letter Qlashique room code.');
      return;
    }

    qlasIsHost = false;
    qlasCode = codeInput;
    qlasResetForNewMatch();

    const playerName = getPlayerName();
    showScreen('screen-qlashique');
    qlasShowPhase('waiting');
    qEl('qlas-waiting-panel').style.display = '';

    socket.emit('room:join', { code: qlasCode, playerName }, (res) => {
      if (res.error) {
        showError(res.error);
        return;
      }

      qlasMyIdx = res.myIdx;
      qlasPlayers[0].name = res.players[0]?.name || '';
      qlasPlayers[1].name = res.players[1]?.name || '';
      if (res.qlasHP) {
        qlasMaxHp = res.qlasHP;
        qlasHp = [res.qlasHP, res.qlasHP];
      }
      qEl('qlas-waiting-label').textContent = res.qlasHP
        ? `HP ${res.qlasHP} · Waiting for game to start…`
        : 'Waiting for game to start…';
    });
  });
}

// Export state getters for other modules
export function getQlasMyIdx() {
  return qlasMyIdx;
}
export function getQlasCode() {
  return qlasCode;
}
export function getQlasIsHost() {
  return qlasIsHost;
}
