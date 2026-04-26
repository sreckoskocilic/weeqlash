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
  if (questionTimeout) {
    clearTimeout(questionTimeout);
    questionTimeout = null;
  }
  runStartedAt = Date.now();
  _qel('skipnot-score').textContent = '0';
  _qel('skipnot-counter').textContent = `0/${total}`;
  _qel('skipnot-flash').classList.remove('show');
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

function _flash(outcome, delta) {
  const f = _qel('skipnot-flash');
  if (!f) {
    return;
  }
  let label;
  let cls;
  if (outcome === 'correct') {
    label = 'CORRECT';
    cls = 'hit';
  } else if (outcome === 'wrong') {
    label = 'INCORRECT';
    cls = 'miss';
  } else if (outcome === 'skip') {
    label = 'SKIPPED';
    cls = 'miss';
  } else {
    label = 'TIMEOUT';
    cls = 'miss';
  }
  const sign = delta > 0 ? '+' : '';
  const deltaStr = delta ? '   ' + sign + delta : '';
  f.textContent = '> ' + label + deltaStr;
  f.className = 'qlas-flash show ' + cls;
}

function _renderCurrentQ() {
  resolvedThisQ = false;
  const q = questions[currentIdx];
  if (!q) {
    return;
  }
  _qel('skipnot-counter').textContent = `${currentIdx + 1}/${total}`;
  _qel('skipnot-flash').classList.remove('show');
  renderQuestion(
    {
      questionEl: _qel('skipnot-question'),
      optionsEl: _qel('skipnot-options'),
      flashEl: _qel('skipnot-flash'),
    },
    q,
    currentIdx,
    _onOptionClick,
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
      return;
    }
    const correct = !!res.correct;
    score += correct ? POINT_CORRECT : POINT_WRONG;
    _qel('skipnot-score').textContent = String(score);
    if (optionBtns[idx]) {
      optionBtns[idx].classList.add(correct ? 'correct' : 'wrong');
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
  _flash('timeout', 0);
  _advanceAfterDelay();
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
    // Local correct count for display (server doesn't ship per-Q results to
    // avoid leaking the answer pattern; client reconstructed from its own
    // running tally would be score-derived: each correct = +13, each wrong =
    // -7, others = 0 — so correctCount can't be uniquely inferred from score
    // alone. Show "—" rather than fake the number.
    _qel('skipnot-go-correct').textContent = '—';
    _qel('skipnot-go-duration').textContent = Math.round(res.timeMs / 1000) + 's';
    _qel('skipnot-qualifies-row').style.display = res.qualifies ? '' : 'none';
    if (res.qualifies) {
      _qel('skipnot-name-input').value = '';
      setTimeout(() => _qel('skipnot-name-input').focus(), 50);
    }
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
  });
}
