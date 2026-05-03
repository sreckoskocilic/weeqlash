// SkipNoT (solo 20-Q quiz) client. Same protocol as triviandom/qlashique:
// server keeps correctIdx, client emits each click and gets a boolean back.
// Server hands out all 20 questions upfront so question rendering / next-q
// transitions are local (no per-Q server push). Per-pick verdict is the only
// round-trip per question.
//
// Local timer: 12s per question, fires `_onTimeout` if no click. Skip button
// behaves like timeout-on-demand. After verdict the chosen button is colored
// (green for correct, red for wrong — never reveals correct answer index),
// then a short delay before advancing to the next question.

import { el, showScreen, sanitize } from './dom.js';
import { renderQuestion, makeCountdownRing } from './question-render.js';
import { loadPanelLeaderboard } from './leaderboard.js';
import { showView } from './nav.js';

const TIMER_RING_CIRC = 175.93;
const RESULT_DISPLAY_MS = 800; // colored-button + flash visible time before next q
const POINT_CORRECT = 13;
const POINT_WRONG = -7;

// Per-run UI state. Cleared by `_resetRun` on every fresh start.
let socketRef = null;
let ring = null;
let questions = []; // { id, q, opts, category }[] from skipnot:start
let total = 20;
let timerSec = 12;
let currentIdx = 0;
let score = 0;
let optionBtns = [];
let resolvedThisQ = false; // true between local resolve and next-q render
let questionTimeout = null; // local 12s timeout handle
let runStartedAt = 0;

// UX state: tracks per-Q outcomes, current streak, best streak.
// Outcomes: 'ok' | 'bad' | 'skip' (one entry per resolved question).
let outcomes = [];
let streak = 0;
let bestStreak = 0;
let scoreAnimRaf = null; // count-up animation handle

function _qel(id) {
  return document.getElementById(id);
}

function _showPhase(name) {
  _qel('skipnot-phase-game').style.display = name === 'game' ? '' : 'none';
  _qel('skipnot-phase-gameover').style.display = name === 'gameover' ? '' : 'none';
}

function _resetRun() {
  questions = [];
  currentIdx = 0;
  score = 0;
  optionBtns = [];
  resolvedThisQ = false;
  outcomes = [];
  streak = 0;
  bestStreak = 0;
  if (questionTimeout) {
    clearTimeout(questionTimeout);
    questionTimeout = null;
  }
  if (scoreAnimRaf) {
    cancelAnimationFrame(scoreAnimRaf);
    scoreAnimRaf = null;
  }
  runStartedAt = Date.now();
  _qel('skipnot-score').textContent = '0';
  _qel('skipnot-counter').textContent = `0/${total}`;
  const d = _qel('skipnot-score-delta');
  if (d) {
    d.textContent = '';
    d.className = 'skipnot-score-delta';
  }
  _resetProgressDots();
  _hideStreak();
}

// Build 20 placeholder dots, mark idx 0 as "now".
function _resetProgressDots() {
  const wrap = _qel('skipnot-progress');
  if (!wrap) {
    return;
  }
  const html = [];
  for (let i = 0; i < total; i++) {
    html.push(`<span class="pdot${i === 0 ? ' now' : ''}" data-i="${i}"></span>`);
  }
  wrap.innerHTML = html.join('');
}

// Mark question idx with given state ('ok'/'bad'/'skip'); move "now" to next.
// Use explicit classList.add() with string literals so the unused-selector
// linter can see that .ok / .bad / .skip are referenced from JS.
function _updateProgressDot(idx, state) {
  const wrap = _qel('skipnot-progress');
  if (!wrap) {
    return;
  }
  const dot = wrap.querySelector(`.pdot[data-i="${idx}"]`);
  if (dot) {
    dot.className = 'pdot';
    if (state === 'ok') {
      dot.classList.add('ok');
    } else if (state === 'bad') {
      dot.classList.add('bad');
    } else if (state === 'skip') {
      dot.classList.add('skip');
    }
  }
  const next = wrap.querySelector(`.pdot[data-i="${idx + 1}"]`);
  if (next) {
    next.classList.add('now');
  }
}

// Streak: shown only when >= 3.
function _showStreak(n) {
  const streakEl = _qel('skipnot-streak');
  const num = _qel('skipnot-streak-num');
  if (!streakEl || !num) {
    return;
  }
  num.textContent = String(n);
  streakEl.style.display = '';
}
function _hideStreak() {
  const streakEl = _qel('skipnot-streak');
  if (streakEl) {
    streakEl.style.display = 'none';
  }
}
function _breakStreak() {
  const streakEl = _qel('skipnot-streak');
  if (!streakEl || streakEl.style.display === 'none') {
    return;
  }
  streakEl.classList.remove('broke');
  // force reflow so animation can replay
  void streakEl.offsetWidth;
  streakEl.classList.add('broke');
  setTimeout(() => {
    _hideStreak();
    streakEl.classList.remove('broke');
  }, 400);
}

// Animate score from current displayed value to `target` over ~400ms.
function _animateScore(from, target) {
  const scoreEl = _qel('skipnot-score');
  if (!scoreEl) {
    return;
  }
  if (scoreAnimRaf) {
    cancelAnimationFrame(scoreAnimRaf);
  }
  if (from === target) {
    scoreEl.textContent = String(target);
    return;
  }
  const dur = 400;
  const startT = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - startT) / dur);
    // ease-out cubic
    const eased = 1 - Math.pow(1 - p, 3);
    const v = Math.round(from + (target - from) * eased);
    scoreEl.textContent = String(v);
    if (p < 1) {
      scoreAnimRaf = requestAnimationFrame(step);
    } else {
      scoreAnimRaf = null;
    }
  };
  scoreAnimRaf = requestAnimationFrame(step);
}

function _ensureRing() {
  if (!ring) {
    ring = makeCountdownRing({
      ringEl: _qel('skipnot-turn-timer'),
      labelEl: _qel('skipnot-timer-ring-label'),
      progressEl: _qel('skipnot-timer-ring-progress'),
      ringCirc: TIMER_RING_CIRC,
    });
  }
  return ring;
}

// Show the score delta (+13 / -7 / 0) just left of the live score, color-coded.
// Auto-clears after RESULT_DISPLAY_MS so the next question starts fresh.
let _deltaTimeout = null;
function _flash(outcome, delta) {
  const d = _qel('skipnot-score-delta');
  if (!d) {
    return;
  }
  if (_deltaTimeout) {
    clearTimeout(_deltaTimeout);
  }
  if (!delta) {
    d.textContent = '';
    return;
  }
  const sign = delta > 0 ? '+' : '';
  d.textContent = sign + delta;
  d.className = 'skipnot-score-delta ' + (outcome === 'correct' ? 'hit' : 'miss');
  _deltaTimeout = setTimeout(() => {
    d.textContent = '';
    d.className = 'skipnot-score-delta';
    _deltaTimeout = null;
  }, RESULT_DISPLAY_MS);
}

function _renderCurrentQ() {
  resolvedThisQ = false;
  const q = questions[currentIdx];
  if (!q) {
    return;
  }
  _qel('skipnot-counter').textContent = `${currentIdx + 1}/${total}`;
  renderQuestion(
    {
      questionEl: _qel('skipnot-question'),
      optionsEl: _qel('skipnot-options'),
    },
    q,
    currentIdx,
    _onOptionClick,
    { showCategory: false },
  );
  optionBtns = Array.from(_qel('skipnot-options').querySelectorAll('button'));
  _ensureRing().start(timerSec);
  if (questionTimeout) {
    clearTimeout(questionTimeout);
  }
  questionTimeout = setTimeout(_onTimeout, timerSec * 1000);
}

function _advanceAfterDelay() {
  setTimeout(() => {
    currentIdx += 1;
    if (currentIdx >= questions.length) {
      _finishRun();
    } else {
      _renderCurrentQ();
    }
  }, RESULT_DISPLAY_MS);
}

function _disableAllOptions() {
  optionBtns.forEach((b) => {
    b.disabled = true;
  });
}

function _onOptionClick(idx) {
  if (resolvedThisQ) {
    return;
  }
  resolvedThisQ = true;
  ring?.stop();
  if (questionTimeout) {
    clearTimeout(questionTimeout);
    questionTimeout = null;
  }
  _disableAllOptions();
  const q = questions[currentIdx];
  socketRef?.emit('skipnot:answer', { id: q.id, optionIdx: idx }, (res) => {
    if (res?.error) {
      console.warn('[skipnot] answer rejected:', res.error);
      // server-side rejection (rare) — re-arm so user can retry within timer
      resolvedThisQ = false;
      optionBtns.forEach((b) => {
        b.disabled = false;
      });
      _ensureRing().start(timerSec); // approximate; small fairness loss
      questionTimeout = setTimeout(_onTimeout, timerSec * 1000);
      return;
    }
    const correct = !!res.correct;
    const prevScore = score;
    score += correct ? POINT_CORRECT : POINT_WRONG;
    _animateScore(prevScore, score);
    if (optionBtns[idx]) {
      optionBtns[idx].classList.add(correct ? 'correct' : 'wrong');
    }
    // Outcomes / streak / progress dot
    outcomes.push(correct ? 'ok' : 'bad');
    _updateProgressDot(currentIdx, correct ? 'ok' : 'bad');
    if (correct) {
      streak += 1;
      if (streak > bestStreak) {
        bestStreak = streak;
      }
      if (streak >= 3) {
        _showStreak(streak);
      }
    } else if (streak >= 3) {
      _breakStreak();
      streak = 0;
    } else {
      streak = 0;
    }
    _flash(correct ? 'correct' : 'wrong', correct ? POINT_CORRECT : POINT_WRONG);
    _advanceAfterDelay();
  });
}

function _onSkipClick() {
  if (resolvedThisQ) {
    return;
  }
  resolvedThisQ = true;
  ring?.stop();
  if (questionTimeout) {
    clearTimeout(questionTimeout);
    questionTimeout = null;
  }
  _disableAllOptions();
  const q = questions[currentIdx];
  socketRef?.emit('skipnot:skip', { id: q.id }, (res) => {
    if (res?.error) {
      console.warn('[skipnot] skip rejected:', res.error);
    }
    // skip = 0 score; nothing colored.
    outcomes.push('skip');
    _updateProgressDot(currentIdx, 'skip');
    if (streak >= 3) {
      _breakStreak();
    }
    streak = 0;
    _flash('skip', 0);
    _advanceAfterDelay();
  });
}

function _onTimeout() {
  if (resolvedThisQ) {
    return;
  }
  resolvedThisQ = true;
  ring?.stop();
  questionTimeout = null;
  _disableAllOptions();
  // Tell the server we abandoned this Q so its cursor advances in lockstep.
  // (Skip and timeout both score 0, so the server treats them identically.)
  const q = questions[currentIdx];
  socketRef?.emit('skipnot:skip', { id: q.id }, (res) => {
    if (res?.error) {
      console.warn('[skipnot] timeout-skip rejected:', res.error);
    }
  });
  outcomes.push('skip');
  _updateProgressDot(currentIdx, 'skip');
  if (streak >= 3) {
    _breakStreak();
  }
  streak = 0;
  _flash('timeout', 0);
  _advanceAfterDelay();
}

function _renderHeatmap() {
  const wrap = _qel('skipnot-heatmap');
  if (!wrap) {
    return;
  }
  wrap.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const o = outcomes[i];
    const ch = o === 'ok' ? '✓' : o === 'bad' ? '✕' : o === 'skip' ? '−' : '';
    const cell = document.createElement('div');
    cell.className = 'hcell';
    if (o === 'ok') {
      cell.classList.add('ok');
    } else if (o === 'bad') {
      cell.classList.add('bad');
    } else if (o === 'skip') {
      cell.classList.add('skip');
    }
    cell.textContent = ch;
    wrap.appendChild(cell);
  }
}

function _finishRun() {
  if (questionTimeout) {
    clearTimeout(questionTimeout);
    questionTimeout = null;
  }
  ring?.stop();
  const totalMs = Date.now() - runStartedAt;
  socketRef?.emit('skipnot:finish', { totalMs }, (res) => {
    if (res?.error) {
      console.warn('[skipnot] finish failed:', res.error);
      return;
    }
    _qel('skipnot-go-score').textContent = String(res.score);
    // Per-Q outcomes tracked locally — count correct here.
    const correctCount = outcomes.filter((o) => o === 'ok').length;
    _qel('skipnot-go-correct').textContent = `${correctCount}/${total}`;
    _qel('skipnot-go-duration').textContent = Math.round(res.timeMs / 1000) + 's';
    const bestEl = _qel('skipnot-go-best-streak');
    if (bestEl) {
      bestEl.textContent = String(bestStreak);
    }
    _renderHeatmap();
    _qel('skipnot-qualifies-row').style.display = res.qualifies ? '' : 'none';
    _qel('btn-skipnot-submit-score').style.display = res.qualifies ? '' : 'none';
    if (res.qualifies) {
      _qel('skipnot-name-input').value = '';
      setTimeout(() => _qel('skipnot-name-input').focus(), 50);
    }
    loadPanelLeaderboard('skipnot', 'skipnot-go-lb-rows');
    _showPhase('gameover');
  });
}

function _onSubmitScore() {
  const input = _qel('skipnot-name-input');
  const name = input.value.trim();
  if (!name) {
    return;
  }
  socketRef?.emit('skipnot:submit_score', { name }, (res) => {
    if (res?.error) {
      console.warn('[skipnot] submit_score:', res.error);
      return;
    }
    _qel('skipnot-qualifies-row').style.display = 'none';
    _qel('btn-skipnot-submit-score').style.display = 'none';
    // Refresh lb so the new entry appears with the just-submitted name.
    loadPanelLeaderboard('skipnot', 'skipnot-go-lb-rows');
  });
}

function _startRun() {
  _resetRun();
  _showPhase('game');
  showScreen('screen-skipnot');
  socketRef?.emit('skipnot:start', (res) => {
    if (res?.error) {
      console.warn('[skipnot] start failed:', res.error);
      _qel('skipnot-question').innerHTML =
        '<div class="qlas-q-text">' + sanitize(res.error) + '</div>';
      return;
    }
    questions = res.questions || [];
    total = res.total ?? questions.length;
    timerSec = (res.timerMs ?? 12000) / 1000;
    currentIdx = 0;
    runStartedAt = Date.now();
    _renderCurrentQ();
  });
}

// --- Public init ---

export function initSkipnot(sock) {
  socketRef = sock;

  el('btn-skipnot-create').addEventListener('click', _startRun);
  el('btn-skipnot-skip').addEventListener('click', _onSkipClick);
  el('btn-skipnot-submit-score').addEventListener('click', _onSubmitScore);
  el('btn-skipnot-back').addEventListener('click', () => {
    showScreen('screen-connect');
    showView('play');
    // Re-fetch /auth/me so the home reflects current server-side session
    // (fixes the case where session/cookie state drifted during the run and
    // the auth-aware nav items get the wrong visibility on return).
    import('./auth.js').then(({ checkAuth }) => checkAuth());
  });

  // Connect-screen leaderboard toggle (mirrors triviandom's btn-show-triv-lb).
  const lbBtn = el('btn-show-skipnot-lb');
  const lbPanel = el('skipnot-lb-panel');
  if (lbBtn && lbPanel) {
    lbBtn.addEventListener('click', () => {
      const visible = lbPanel.style.display !== 'none';
      lbPanel.style.display = visible ? 'none' : '';
      lbBtn.textContent = visible ? 'Show SkipNoT Leaderboard' : 'Hide Leaderboard';
      if (!visible) {
        loadPanelLeaderboard('skipnot', 'skipnot-lb-rows');
      }
    });
  }
}
