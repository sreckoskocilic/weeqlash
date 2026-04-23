// ============================================================
// QLASHIQUE MODULE (1v1 trivia duel)
// ============================================================

import { el, showScreen, showError, sanitize, getPlayerName } from './dom.js';
import { getSocket } from './socket.js';

// Class metadata
export const QLAS_CLASS_META = {
  slowpoke: {
    icon: '🐢',
    name: 'SLOWPOKE',
    tag: 'extra time · consistent',
  },
  reroll: { icon: '🎲', name: 'REROLL', tag: 'one shot · smart skip' },
};

// State
let qlasCode = null;
let qlasMyIdx = null;
let qlasIsHost = false;
let qlasSelectedClass = null;
let qlasClassConfirmed = false;
let qlasPlayers = [
  { name: '', classId: '' },
  { name: '', classId: '' },
];
let qlasHp = [30, 30];
let qlasScore = 0;
let qlasCurrentQ = null;
let qlasQIdx = 0;
let qlasTimerTotal = 5;
let qlasTimerLeft = 5;
let qlasTimerInterval = null;
let qlasGuessingActive = false;
let qlasLastAnswerIdx = -1;
let qlasToken = null;
let qlasLiveHistory = [];

const QLAS_TIMER_RING_CIRC = 175.93; // 2 * PI * r where r=28

// --- UI helpers ---

function qEl(id) {
  return document.getElementById(id);
}

export function qlasShowPhase(phase) {
  ['qlas-phase-class', 'qlas-phase-combat', 'qlas-phase-gameover'].forEach((id) => {
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
  bar.classList.add(type === 'dmg' ? 'qlas-take-dmg' : 'qlas-take-heal');
  setTimeout(() => bar.classList.remove('qlas-take-dmg', 'qlas-take-heal'), 700);
}

export function qlasRenderQuestion(q, idx) {
  qlasCurrentQ = q;
  qlasQIdx = idx;
  qEl('qlas-question').textContent = q.q;
  const opts = qEl('qlas-options');
  opts.innerHTML = '';
  q.opts.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'qlas-opt';
    btn.innerHTML = '<span class="qlas-opt-key">' + 'ABCD'[i] + '</span>' + sanitize(opt);
    btn.onclick = () => qlasSubmitAnswer(i);
    opts.appendChild(btn);
  });
}

export function qlasStartTimer(seconds) {
  qlasTimerTotal = seconds;
  qlasTimerLeft = seconds;
  clearInterval(qlasTimerInterval);
  qlasTimerInterval = setInterval(() => {
    qlasTimerLeft = Math.max(0, qlasTimerLeft - 0.1);
    const pct = qlasTimerLeft / qlasTimerTotal;
    const state = pct < 0.25 ? ' danger' : pct < 0.5 ? ' warn' : '';
    qEl('qlas-timer-fill').style.width = pct * 100 + '%';
    qEl('qlas-timer-fill').className = 'qlas-timer-fill' + state;
    const secs = Math.ceil(qlasTimerLeft);
    qEl('qlas-turn-timer').className = 'qlas-timer-ring' + state;
    qEl('qlas-timer-ring-label').textContent = secs + 's';
    const progress = qEl('qlas-timer-ring-progress');
    if (progress) {
      progress.setAttribute('stroke-dashoffset', String((1 - pct) * QLAS_TIMER_RING_CIRC));
    }
    if (qlasTimerLeft <= 0) {
      clearInterval(qlasTimerInterval);
    }
  }, 100);
}

export function qlasStopTimer() {
  clearInterval(qlasTimerInterval);
  qlasTimerInterval = null;
}

export function qlasRenderPlayerInfo() {
  [0, 1].forEach((i) => {
    const p = qlasPlayers[i];
    const meta = QLAS_CLASS_META[p.classId] || {};
    qEl('qlas-p' + i + 'name').textContent = p.name || 'Player ' + (i + 1);
    qEl('qlas-p' + i + 'class').textContent = meta.name || '—';
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
  qlasPlayers = res.players.map((p, i) => ({
    name: p.name || '',
    classId: res.classSelections[i] || '',
  }));

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

// --- Class selection (exposed on window for onclick handlers) ---

export function qlasSelectClass(classId) {
  if (qlasClassConfirmed) {
    return;
  }
  qlasSelectedClass = classId;
  document.querySelectorAll('.qlas-card').forEach((c) => c.classList.remove('selected'));
  qEl('qlas-card-' + classId).classList.add('selected');
  const meta = QLAS_CLASS_META[classId];
  const color = classId === 'slowpoke' ? '#5c9ee5' : '#c9a227';
  qEl('qlas-confirm-icon').textContent = meta.icon;
  qEl('qlas-confirm-icon').style.borderColor = color;
  qEl('qlas-confirm-name').textContent = meta.name;
  qEl('qlas-confirm-name').style.color = color;
  qEl('qlas-confirm-tag').textContent = meta.tag;
  const confirmBtn = qEl('qlas-btn-confirm');
  confirmBtn.disabled = false;
  confirmBtn.style.background = color;
}

export function qlasConfirm() {
  if (!qlasSelectedClass) {
    return;
  }
  qlasClassConfirmed = true;
  qEl('qlas-btn-confirm').disabled = true;
  document.querySelectorAll('.qlas-card').forEach((c) => {
    c.style.pointerEvents = 'none';
    c.style.opacity = '0.7';
  });
  qlasLiveHistory = [];
  const socket = getSocket();
  const playerName = getPlayerName();
  if (qlasIsHost) {
    socket.emit('qlashique:create_room', { playerName }, (res) => {
      if (res.error) {
        qlasClassConfirmed = false;
        qEl('qlas-btn-confirm').disabled = false;
        return;
      }
      qlasCode = res.code;
      qlasToken = res.token;
      qlasMyIdx = 0;
      qlasPlayers[0].name = playerName;
      qEl('qlas-waiting-panel').style.display = '';
      qEl('qlas-waiting-label').textContent = 'Waiting for opponent…';
      qEl('qlas-code-row').style.display = '';
      qEl('qlas-code-val').textContent = res.code;
      socket.emit(
        'qlashique:select_class',
        { code: qlasCode, classId: qlasSelectedClass },
        () => {},
      );
    });
  } else {
    const code = qlasCode;
    socket.emit('room:join', { code, playerName }, (res) => {
      if (res.error) {
        qlasClassConfirmed = false;
        qEl('qlas-btn-confirm').disabled = false;
        return;
      }
      qlasToken = res.token;
      qlasMyIdx = res.myIdx;
      qlasPlayers[0].name = res.players[0]?.name || '';
      qlasPlayers[1].name = res.players[1]?.name || '';
      qEl('qlas-waiting-panel').style.display = '';
      qEl('qlas-waiting-label').textContent = 'Waiting for game to start…';
      socket.emit('qlashique:select_class', { code, classId: qlasSelectedClass }, () => {});
    });
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

export function qlasReroll() {
  const socket = getSocket();
  socket.emit('qlashique:reroll', { code: qlasCode }, (res) => {
    if (!res?.error) {
      qEl('btn-qlas-reroll').disabled = true;
    }
  });
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
    const correctLabel = 'ABCD'[e.correctIdx] + '. ' + sanitize(e.opts?.[e.correctIdx] ?? '?');
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
      (e.correct
        ? ''
        : '<span class="muted">·</span><span class="ok">correct ' + correctLabel + '</span>') +
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

export function initQlashique(socket) {
  // Expose functions on window for onclick handlers
  window.qlasSelectClass = qlasSelectClass;
  window.qlasConfirm = qlasConfirm;
  window.qlasStartGuessing = qlasStartGuessing;
  window.qlasReroll = qlasReroll;
  window.qlasStopAttack = qlasStopAttack;
  window.qlasEndTurn = qlasEndTurn;
  window.qlasHeal = qlasHeal;

  window.qlasToggleRecap = function () {
    const container = qEl('qlas-recap');
    const toggle = qEl('qlas-recap-toggle');
    if (!container || !toggle) {
      return;
    }
    const hidden = container.style.display === 'none';
    container.style.display = hidden ? 'flex' : 'none';
    toggle.textContent = hidden ? '[ hide recap ]' : '[ show recap ]';
  };

  window.qlasOpenLiveRecap = function () {
    qlasPopulateRecap('qlas-recap-live', qlasLiveHistory);
    qEl('qlas-recap-modal')?.classList.add('show');
  };

  window.qlasCloseLiveRecap = function (event) {
    if (event && event.target && event.currentTarget && event.target !== event.currentTarget) {
      return;
    }
    qEl('qlas-recap-modal')?.classList.remove('show');
  };

  // Socket events
  socket.on('qlashique:class_selected', ({ playerIdx, classId }) => {
    qlasPlayers[playerIdx].classId = classId;
  });

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
    qlasGuessingActive = false;
    qEl('qlas-qpanel').style.display = 'none';
    qEl('qlas-action-row').style.display = 'none';
    qEl('btn-qlas-stop').style.display = 'none';
    qEl('btn-qlas-end').style.display = 'none';
    qEl('btn-qlas-heal').style.display = 'none';
    qEl('qlas-waiting-panel').style.display = 'none';
    qEl('qlas-phase-class').style.display = 'none';
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
      qlasTimerLeft = timerSeconds;
    } else {
      qEl('qlas-decision-panel').style.display = 'none';
    }
  });

  socket.on('qlashique:question', ({ question, questionIdx, activePlayerIdx }) => {
    const isMyTurn = activePlayerIdx === qlasMyIdx;
    if (questionIdx === 0) {
      qlasGuessingActive = isMyTurn;
      qEl('qlas-decision-panel').style.display = 'none';
      qEl('qlas-action-row').style.display = isMyTurn ? '' : 'none';
      qEl('btn-qlas-stop').style.display = isMyTurn ? '' : 'none';
      qEl('btn-qlas-end').style.display = 'none';
      qEl('btn-qlas-heal').style.display = 'none';
      qEl('qlas-qpanel').style.display = '';
      qEl('qlas-qpanel').style.opacity = '1.0';
      qEl('btn-qlas-reroll').style.display = 'none';
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
    ({ correct, newScore, playerIdx, answerIdx, correctIdx, category, q, opts, turn }) => {
      if (playerIdx === qlasMyIdx) {
        const btns = document.querySelectorAll('.qlas-opt');
        if (qlasLastAnswerIdx >= 0 && btns[qlasLastAnswerIdx]) {
          btns[qlasLastAnswerIdx].classList.add(correct ? 'correct' : 'wrong');
        }
        qlasSetScore(newScore);
      } else {
        qlasSetScoreOther(playerIdx, newScore);
      }
      if (typeof q === 'string') {
        qlasLiveHistory.push({
          turn,
          playerIdx,
          category,
          q,
          opts,
          answerIdx,
          correctIdx,
          correct,
          scoreAfter: newScore,
        });
      }
    },
  );

  socket.on('qlashique:rerolled', ({ newQuestion }) => {
    qlasRenderQuestion(newQuestion, qlasQIdx);
    document.querySelectorAll('.qlas-opt').forEach((b) => (b.disabled = false));
  });

  socket.on('qlashique:turn_end', () => {
    qlasStopTimer();
    qlasGuessingActive = false;
    qEl('qlas-action-row').style.display = 'none';
    qEl('qlas-qpanel').style.opacity = '0.4';
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
    qlasSetHP(0, p0hp);
    qlasSetHP(1, p1hp);
    if (p0hp < prev0) qlasFlash(0, 'dmg');
    if (p1hp < prev1) qlasFlash(1, 'dmg');
    if (p0hp > prev0) qlasFlash(0, 'heal');
    if (p1hp > prev1) qlasFlash(1, 'heal');
  });

  socket.on('qlashique:game_over', ({ winnerIdx, reason, history }) => {
    qlasStopTimer();
    qEl('qlas-phase-combat').style.display = 'none';
    qEl('qlas-phase-gameover').style.display = '';
    const isWinner = winnerIdx === qlasMyIdx;
    const winnerName = qlasPlayers[winnerIdx]?.name || 'Player ' + (winnerIdx + 1);
    qEl('qlas-winner-text').textContent = isWinner ? '🏆 YOU WIN!' : winnerName + ' WINS';
    const reasonMap = {
      hp: 'opponent ran out of HP',
      instant_win: 'instant win — perfect streak of 10+',
      self_destruct: 'self-destruct',
      disconnect: 'opponent disconnected',
    };
    qEl('qlas-winner-reason').textContent = reasonMap[reason] || reason;
    qlasRenderRecap(Array.isArray(history) ? history : []);
  });

  // Start button handler
  el('btn-qlas-start').addEventListener('click', () => {
    const codeInput = el('qlas-join-code').value.trim().toUpperCase();
    qlasIsHost = !codeInput;
    qlasCode = codeInput || null;

    if (!qlasIsHost && codeInput.length !== 5) {
      showError('Enter a 5-letter Qlashique room code, or leave blank to create.');
      return;
    }

    // Reset state
    qlasSelectedClass = null;
    qlasClassConfirmed = false;
    qlasPlayers = [
      { name: '', classId: '' },
      { name: '', classId: '' },
    ];
    qlasHp = [30, 30];
    qlasScore = 0;
    qlasToken = null;
    qlasGuessingActive = false;

    const playerName = getPlayerName();
    showScreen('screen-qlashique');
    qlasShowPhase('class');
    qEl('qlas-class-grid').style.display = 'none';
    qEl('qlas-confirm-row').style.display = 'none';
    qEl('qlas-waiting-panel').style.display = '';

    if (qlasIsHost) {
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
    } else {
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
    }
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
