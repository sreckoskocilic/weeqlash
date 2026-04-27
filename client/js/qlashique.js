// ============================================================
// QLASHIQUE MODULE (1v1 trivia duel)
// ============================================================

import { el, showScreen, showError, sanitize, getPlayerName } from './dom.js';
import { getSocket } from './socket.js';
import { renderQuestion, makeCountdownRing } from './question-render.js';

// State
let qlasCode = null;
let qlasMyIdx = null;
let qlasIsHost = false;
let qlasPlayers = [{ name: '' }, { name: '' }];
let qlasHp = [30, 30];
let qlasScore = 0;
let qlasCurrentQ = null;
let qlasQIdx = 0;
let qlasTimerTotal = 5;
let qlasRing = null; // CountdownRing, lazily created on first qlasStartTimer
let qlasGuessingActive = false;
let qlasLastAnswerIdx = -1;
let qlasToken = null;
let qlasLiveHistory = [];
let qlasMatchStart = null;
let qlasStreak = [0, 0];
// Per-turn UX bookkeeping
let qlasActivePlayerIdx = null; // who's currently taking the turn
let qlasLastScoreByPlayer = [0, 0]; // remembered after each answer; classified at turn_end
let qlasTurnAnswerCount = [0, 0]; // # answers given this turn (for recap line)
let qlasTurnCorrectCount = [0, 0];

const QLAS_TIMER_RING_CIRC = 175.93; // 2 * PI * r where r=28

// --- UI helpers ---

function qEl(id) {
  return document.getElementById(id);
}

export function qlasShowPhase(phase) {
  ['qlas-phase-waiting', 'qlas-phase-combat', 'qlas-phase-gameover'].forEach((id) => {
    qEl(id).style.display = 'none';
  });
  qEl('qlas-phase-' + phase).style.display = '';
}

export function qlasSetHP(playerIdx, hp) {
  hp = Math.max(0, Math.min(30, hp));
  qlasHp[playerIdx] = hp;
  qEl('qlas-p' + playerIdx + 'hp').textContent = hp;
  qEl('qlas-p' + playerIdx + 'hpbar').style.width = (hp / 30) * 100 + '%';
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
  if (type === 'dmg') bar.classList.add('qlas-take-dmg');
  else bar.classList.add('qlas-take-heal');
  setTimeout(() => bar.classList.remove('qlas-take-dmg', 'qlas-take-heal'), 700);
}

// Spawn a floating "−4" / "+2" number above a player's pbar; auto-removes after anim.
function qlasFloatNum(playerIdx, delta, type) {
  const host = qEl('qlas-p' + playerIdx + 'float');
  if (!host || !delta) return;
  const span = document.createElement('span');
  span.className = 'qlas-floating-num';
  if (type === 'dmg') span.classList.add('dmg');
  else if (type === 'heal') span.classList.add('heal');
  const sign = delta > 0 ? '+' : '';
  span.textContent = sign + delta;
  host.appendChild(span);
  setTimeout(() => span.remove(), 1300);
}

// Spawn a small +1 / −1 next to the running score; auto-removes after anim.
function qlasScoreMiniFlash(delta) {
  if (!delta) return;
  const host = qEl('qlas-turn-score');
  if (!host) return;
  const span = document.createElement('span');
  span.className = 'qlas-score-mini';
  if (delta > 0) span.classList.add('up');
  else span.classList.add('down');
  span.textContent = (delta > 0 ? '+' : '') + delta;
  host.appendChild(span);
  setTimeout(() => span.remove(), 1000);
}

// Push one outcome dot for the just-ended turn.
function qlasPushHistoryDot(playerIdx, score) {
  const host = qEl('qlas-history-dots');
  if (!host) return;
  const dot = document.createElement('span');
  dot.className = 'hd';
  if (score > 0) dot.classList.add('win');
  else if (score < 0) dot.classList.add('loss');
  else dot.classList.add('zero');
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
  if (host) host.innerHTML = '';
}

// Show / update / hide the streak badge for a player.
function qlasUpdateStreakBadge(playerIdx) {
  const el = qEl('qlas-p' + playerIdx + 'streak');
  if (!el) return;
  const num = el.querySelector('.num');
  const n = qlasStreak[playerIdx] || 0;
  if (n >= 2) {
    if (num) num.textContent = String(n);
    el.classList.add('show');
  } else {
    el.classList.remove('show');
  }
}

export function qlasRenderQuestion(q, idx) {
  if (!qlasMatchStart) qlasMatchStart = Date.now();
  qlasCurrentQ = q;
  qlasQIdx = idx;
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
  const el = qEl('qlas-flash');
  if (!el) return;
  const sign = delta > 0 ? '+' : '';
  const deltaStr = delta ? '   ' + sign + delta : '';
  el.textContent = '> ' + (correct ? 'CORRECT' : 'INCORRECT') + deltaStr;
  el.className = 'qlas-flash show ' + (correct ? 'hit' : 'miss');
  clearTimeout(qlasShowFlash._t);
  qlasShowFlash._t = setTimeout(() => el.classList.remove('show'), 900);
}

// Append a transient log entry (combo streaks, events)
function qlasLogEntry(text) {
  const log = qEl('qlas-log');
  if (!log) return;
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
    group.turn +
    '</span>' +
    '<span class="' +
    playerClass +
    '">' +
    sanitize(playerName) +
    '</span>' +
    '<span class="qlas-recap-score">' +
    scoreSign +
    lastEntry.scoreAfter +
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
    if (e.target === e.currentTarget) qlasCloseLiveRecap();
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

  socket.on('qlashique:turn_start', ({ playerIdx, timerSeconds }) => {
    qlasStopTimer();
    qlasScore = 0;
    qlasActivePlayerIdx = playerIdx;
    qlasTurnAnswerCount = [0, 0];
    qlasTurnCorrectCount = [0, 0];
    qlasGuessingActive = false;
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
    const activeColor = playerIdx === 0 ? '#00ff41' : '#00b8ff';
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
    // Show "guessing..." on the opponent's pbar while they answer.
    [0, 1].forEach((i) => {
      const t = qEl('qlas-p' + i + 'thinking');
      if (!t) return;
      if (i === activePlayerIdx && i !== qlasMyIdx) t.classList.add('active');
      else t.classList.remove('active');
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
    } else if (isMyTurn) {
      document.querySelectorAll('.qlas-opt').forEach((b) => (b.disabled = false));
    }
    qlasRenderQuestion(question, questionIdx);
    if (!isMyTurn) {
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
      if (correct) qlasTurnCorrectCount[playerIdx] = (qlasTurnCorrectCount[playerIdx] || 0) + 1;
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
    qlasStopTimer();
    qEl('qlas-phase-combat').style.display = 'none';
    qEl('qlas-phase-gameover').style.display = '';
    const isWinner = winnerIdx === qlasMyIdx;
    const winnerName = qlasPlayers[winnerIdx]?.name || 'Player ' + (winnerIdx + 1);
    qEl('qlas-winner-text').textContent = isWinner ? '🏆 YOU WIN!' : winnerName + ' WINS';
    const reasonMap = {
      hp: 'Player defeated (0 HP)',
      instant_win: 'perfect streak',
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
    qlasPlayers = [{ name: '' }, { name: '' }];
    qlasHp = [30, 30];
    qlasScore = 0;
    qlasToken = null;
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

  el('btn-qlas-create').addEventListener('click', () => {
    qlasIsHost = true;
    qlasCode = null;
    qlasResetForNewMatch();

    const playerName = getPlayerName();
    showScreen('screen-qlashique');
    qlasShowPhase('waiting');
    qEl('qlas-waiting-panel').style.display = '';

    socket.emit('qlashique:create_room', { playerName }, (res) => {
      if (res.error) {
        showError(res.error);
        return;
      }
      qlasCode = res.code;
      qlasToken = res.token;
      qlasMyIdx = 0;
      qlasPlayers[0].name = playerName;
      qEl('qlas-waiting-label').textContent = 'Waiting for opponent…';
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
      qlasToken = res.token;
      qlasMyIdx = res.myIdx;
      qlasPlayers[0].name = res.players[0]?.name || '';
      qlasPlayers[1].name = res.players[1]?.name || '';
      qEl('qlas-waiting-label').textContent = 'Waiting for game to start…';
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
