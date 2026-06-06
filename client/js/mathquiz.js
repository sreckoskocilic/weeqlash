// MathQuiz (solo numeric-input math/calculus quiz) client.
//
// Procedurally generated server-side: the client receives only public fields
// (prompt / KaTeX tex / sampled graph points / points) — never the answer.
// Each problem is rendered with KaTeX (notation) and/or a canvas graph; the
// player types a number and submits. The server scores each guess and returns
// the OUTCOME (correct / partial / wrong) plus points earned — the true answer
// is NEVER sent or displayed, not mid-round and not on the review screen.
//
// Local timer per question (server cursor stays in lockstep via answer/skip).

import { el, showScreen } from './dom.js';
import { makeCountdownRing } from './question-render.js';
import { loadPanelLeaderboard } from './leaderboard.js';
import { showView } from './nav.js';
import { drawGraph, drawFigure } from './mathgraph.js';
import katex from '../vendor/katex/katex.mjs';

const TIMER_RING_CIRC = 175.93;
const _testSpeed = Number(new URLSearchParams(window.location.search).get('testSpeed')) || 1;
const RESULT_DISPLAY_MS = 900 / _testSpeed;

// Per-run UI state. Cleared by _resetRun on every fresh start.
let socketRef = null;
let ring = null;
let problems = []; // { index, prompt, tex?, graph?, points }[] from mathquiz:start
let total = 10;
let timerSec = 45;
let currentIdx = 0;
let score = 0;
let resolvedThisQ = false;
let questionTimeout = null;
let runStartedAt = 0;
let outcomes = []; // 'correct' | 'partial' | 'wrong' | 'skip' per resolved question
let scoreAnimRaf = null;

function _qel(id) {
  return document.getElementById(id);
}

function _showPhase(name) {
  _qel('mathquiz-phase-game').style.display = name === 'game' ? '' : 'none';
  _qel('mathquiz-phase-gameover').style.display = name === 'gameover' ? '' : 'none';
}

function _clearTimeout() {
  if (questionTimeout) {
    clearTimeout(questionTimeout);
    questionTimeout = null;
  }
}

function _armTimeout() {
  _clearTimeout();
  questionTimeout = setTimeout(_onTimeout, timerSec * 1000);
}

function _resetRun() {
  problems = [];
  currentIdx = 0;
  score = 0;
  resolvedThisQ = false;
  outcomes = [];
  _clearTimeout();
  if (scoreAnimRaf) {
    cancelAnimationFrame(scoreAnimRaf);
    scoreAnimRaf = null;
  }
  runStartedAt = Date.now();
  _qel('mathquiz-score').textContent = '0';
  _qel('mathquiz-counter').textContent = `0/${total}`;
  const d = _qel('mathquiz-score-delta');
  if (d) {
    d.textContent = '';
    d.className = 'skipnot-score-delta';
  }
  _resetProgressDots();
}

function _resetProgressDots() {
  const wrap = _qel('mathquiz-progress');
  if (!wrap) {
    return;
  }
  const html = [];
  for (let i = 0; i < total; i++) {
    html.push(`<span class="pdot${i === 0 ? ' now' : ''}" data-i="${i}"></span>`);
  }
  wrap.innerHTML = html.join('');
}

// Mark dot idx with outcome state; move "now" to next.
// Explicit classList.add with literals so the unused-selector linter sees them.
function _updateProgressDot(idx, outcome) {
  const wrap = _qel('mathquiz-progress');
  if (!wrap) {
    return;
  }
  const dot = wrap.querySelector(`.pdot[data-i="${idx}"]`);
  if (dot) {
    dot.className = 'pdot';
    if (outcome === 'correct') {
      dot.classList.add('ok');
    } else if (outcome === 'partial') {
      dot.classList.add('part');
    } else if (outcome === 'wrong') {
      dot.classList.add('bad');
    } else {
      dot.classList.add('skip');
    }
  }
  const next = wrap.querySelector(`.pdot[data-i="${idx + 1}"]`);
  if (next) {
    next.classList.add('now');
  }
}

function _animateScore(from, target) {
  const scoreEl = _qel('mathquiz-score');
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
    const eased = 1 - Math.pow(1 - p, 3);
    scoreEl.textContent = String(Math.round(from + (target - from) * eased));
    if (p < 1) {
      scoreAnimRaf = requestAnimationFrame(step);
    } else {
      scoreAnimRaf = null;
    }
  };
  scoreAnimRaf = requestAnimationFrame(step);
}

let _deltaTimeout = null;
function _flash(outcome, delta, bonus) {
  const d = _qel('mathquiz-score-delta');
  if (!d) {
    return;
  }
  if (_deltaTimeout) {
    clearTimeout(_deltaTimeout);
  }
  d.textContent = (delta > 0 ? '+' + delta : '0') + (bonus ? ' ★' : '');
  d.className =
    'skipnot-score-delta ' + (outcome === 'correct' || outcome === 'partial' ? 'hit' : 'miss');
  _deltaTimeout = setTimeout(() => {
    d.textContent = '';
    d.className = 'skipnot-score-delta';
    _deltaTimeout = null;
  }, RESULT_DISPLAY_MS);
}

function _input() {
  return _qel('mathquiz-input');
}

function _lockInput(locked) {
  const inp = _input();
  if (inp) {
    inp.disabled = locked;
  }
  const btn = _qel('btn-mathquiz-submit');
  if (btn) {
    btn.disabled = locked;
  }
}

// Color the player's own input by outcome. The correct answer is never shown.
function _colorInput(outcome) {
  const inp = _input();
  if (!inp) {
    return;
  }
  inp.classList.remove(
    'mathquiz-input--correct',
    'mathquiz-input--partial',
    'mathquiz-input--wrong',
  );
  if (outcome === 'correct') {
    inp.classList.add('mathquiz-input--correct');
  } else if (outcome === 'partial') {
    inp.classList.add('mathquiz-input--partial');
  } else if (outcome === 'wrong') {
    inp.classList.add('mathquiz-input--wrong');
  }
}

function _shakeInput() {
  const inp = _input();
  if (!inp) {
    return;
  }
  inp.classList.remove('mathquiz-input--shake');
  void inp.offsetWidth; // reflow to replay animation
  inp.classList.add('mathquiz-input--shake');
}

// Parse "3", "3.5", "-2", "1/3", "1,5" → number, or null if unparseable.
function _parseAnswer(raw) {
  const s = String(raw).trim().replace(',', '.');
  if (!s) {
    return null;
  }
  const frac = s.match(/^(-?\d*\.?\d+)\s*\/\s*(-?\d*\.?\d+)$/);
  if (frac) {
    const den = parseFloat(frac[2]);
    return den === 0 ? null : parseFloat(frac[1]) / den;
  }
  const v = parseFloat(s);
  return Number.isFinite(v) && /^[-+]?[\d.]+$/.test(s) ? v : null;
}

function _ensureRing() {
  if (!ring) {
    ring = makeCountdownRing({
      ringEl: _qel('mathquiz-turn-timer'),
      labelEl: _qel('mathquiz-timer-ring-label'),
      progressEl: _qel('mathquiz-timer-ring-progress'),
      ringCirc: TIMER_RING_CIRC,
    });
  }
  return ring;
}

function _renderCurrentProblem() {
  resolvedThisQ = false;
  const p = problems[currentIdx];
  if (!p) {
    return;
  }
  _qel('mathquiz-counter').textContent = `${currentIdx + 1}/${total}`;
  _qel('mathquiz-prompt').textContent = p.prompt || '';

  const texEl = _qel('mathquiz-tex');
  if (p.tex) {
    texEl.style.display = '';
    try {
      katex.render(p.tex, texEl, { throwOnError: false, displayMode: true });
    } catch {
      texEl.textContent = p.tex;
    }
  } else {
    texEl.style.display = 'none';
    texEl.innerHTML = '';
  }

  const canvas = _qel('mathquiz-canvas');
  if (p.graph) {
    canvas.style.display = '';
    drawGraph(canvas, p.graph);
  } else if (p.figure) {
    canvas.style.display = '';
    drawFigure(canvas, p.figure);
  } else {
    canvas.style.display = 'none';
  }

  const inp = _input();
  inp.value = '';
  inp.disabled = false;
  inp.classList.remove(
    'mathquiz-input--correct',
    'mathquiz-input--partial',
    'mathquiz-input--wrong',
  );
  _qel('btn-mathquiz-submit').disabled = false;
  inp.focus();

  _ensureRing().start(timerSec);
  _armTimeout();
}

function _advanceAfterDelay() {
  setTimeout(() => {
    currentIdx += 1;
    if (currentIdx >= problems.length) {
      _finishRun();
    } else {
      _renderCurrentProblem();
    }
  }, RESULT_DISPLAY_MS);
}

function _onSubmit(e) {
  e?.preventDefault();
  if (resolvedThisQ) {
    return;
  }
  const val = _parseAnswer(_input().value);
  if (val === null) {
    _shakeInput();
    return;
  }
  resolvedThisQ = true;
  ring?.stop();
  _clearTimeout();
  _lockInput(true);
  const p = problems[currentIdx];
  socketRef?.emit('mathquiz:answer', { index: p.index, value: val }, (res) => {
    if (res?.error) {
      console.warn('[mathquiz] answer rejected:', res.error);
      resolvedThisQ = false;
      _lockInput(false);
      _input().focus();
      _ensureRing().start(timerSec);
      _armTimeout();
      return;
    }
    const outcome = res.outcome;
    const earned = res.earned || 0;
    const prev = score;
    score += earned;
    _animateScore(prev, score);
    _colorInput(outcome);
    outcomes.push(outcome);
    _updateProgressDot(currentIdx, outcome);
    _flash(outcome, earned, res.bonus);
    _advanceAfterDelay();
  });
}

function _resolveSkip(reason) {
  if (resolvedThisQ) {
    return;
  }
  resolvedThisQ = true;
  ring?.stop();
  _clearTimeout();
  _lockInput(true);
  const p = problems[currentIdx];
  socketRef?.emit('mathquiz:skip', { index: p.index }, (res) => {
    if (res?.error) {
      console.warn(`[mathquiz] ${reason} rejected:`, res.error);
    }
    outcomes.push('skip');
    _updateProgressDot(currentIdx, 'skip');
    _flash('skip', 0);
    _advanceAfterDelay();
  });
}

function _onSkipClick() {
  _resolveSkip('skip');
}

function _onTimeout() {
  questionTimeout = null;
  _resolveSkip('timeout');
}

function _renderHeatmap() {
  const wrap = _qel('mathquiz-heatmap');
  if (!wrap) {
    return;
  }
  wrap.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const o = outcomes[i];
    const ch = o === 'correct' ? '✓' : o === 'partial' ? '≈' : o === 'wrong' ? '✕' : '−';
    const cell = document.createElement('div');
    cell.className = 'hcell';
    if (o === 'correct') {
      cell.classList.add('ok');
    } else if (o === 'partial') {
      cell.classList.add('part');
    } else if (o === 'wrong') {
      cell.classList.add('bad');
    } else {
      cell.classList.add('skip');
    }
    cell.textContent = ch;
    const lbl =
      o === 'correct'
        ? 'Correct'
        : o === 'partial'
          ? 'Partial credit'
          : o === 'wrong'
            ? 'Wrong'
            : 'Skipped';
    cell.title = `Q${i + 1}: ${lbl}`;
    cell.style.animationDelay = i * 40 + 'ms';
    wrap.appendChild(cell);
  }
}

function _finishRun() {
  _clearTimeout();
  ring?.stop();
  const totalMs = Date.now() - runStartedAt;
  socketRef?.emit('mathquiz:finish', { totalMs }, (res) => {
    if (res?.error) {
      console.warn('[mathquiz] finish failed:', res.error);
      return;
    }
    _qel('mathquiz-go-score').textContent = String(res.score);
    const solved = outcomes.filter((o) => o === 'correct').length;
    const partial = outcomes.filter((o) => o === 'partial').length;
    _qel('mathquiz-go-correct').textContent = partial
      ? `${solved}/${total} (+${partial} partial)`
      : `${solved}/${total}`;
    _qel('mathquiz-go-duration').textContent = Math.round(res.timeMs / 1000) + 's';
    _renderHeatmap();
    _qel('mathquiz-qualifies-row').style.display = res.qualifies ? '' : 'none';
    _qel('btn-mathquiz-submit-score').style.display = res.qualifies ? '' : 'none';
    if (res.qualifies) {
      _qel('mathquiz-name-input').value = '';
      setTimeout(() => _qel('mathquiz-name-input').focus(), 50);
    }
    loadPanelLeaderboard('mathquiz', 'mathquiz-go-lb-rows');
    _showPhase('gameover');
  });
}

function _onSubmitScore() {
  const name = _qel('mathquiz-name-input').value.trim();
  if (!name) {
    return;
  }
  socketRef?.emit('mathquiz:submit_score', { name }, (res) => {
    if (res?.error) {
      console.warn('[mathquiz] submit_score:', res.error);
      return;
    }
    _qel('mathquiz-qualifies-row').style.display = 'none';
    _qel('btn-mathquiz-submit-score').style.display = 'none';
    loadPanelLeaderboard('mathquiz', 'mathquiz-go-lb-rows');
  });
}

function _startRun() {
  _resetRun();
  _showPhase('game');
  showScreen('screen-mathquiz');
  socketRef?.emit('mathquiz:start', (res) => {
    if (res?.error) {
      console.warn('[mathquiz] start failed:', res.error);
      _qel('mathquiz-prompt').textContent = res.error;
      return;
    }
    problems = res.problems || [];
    total = res.total ?? problems.length;
    timerSec = (res.timerMs ?? 45000) / 1000;
    currentIdx = 0;
    runStartedAt = Date.now();
    _renderCurrentProblem();
  });
}

// --- Public init ---

export function initMathquiz(sock) {
  socketRef = sock;

  el('btn-mathquiz-create').addEventListener('click', _startRun);
  el('mathquiz-form').addEventListener('submit', _onSubmit);
  el('btn-mathquiz-skip').addEventListener('click', _onSkipClick);
  el('btn-mathquiz-submit-score').addEventListener('click', _onSubmitScore);
  el('btn-mathquiz-back').addEventListener('click', () => {
    showScreen('screen-connect');
    showView('play');
    import('./auth.js').then(({ checkAuth }) => checkAuth());
  });

  const lbBtn = el('btn-show-mathquiz-lb');
  const lbPanel = el('mathquiz-lb-panel');
  if (lbBtn && lbPanel) {
    lbBtn.addEventListener('click', () => {
      const visible = lbPanel.style.display !== 'none';
      lbPanel.style.display = visible ? 'none' : '';
      lbBtn.textContent = visible ? 'Show MathQ Leaderboard' : 'Hide Leaderboard';
      if (!visible) {
        loadPanelLeaderboard('mathquiz', 'mathquiz-lb-rows');
      }
    });
  }
}
