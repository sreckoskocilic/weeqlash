import { el, showScreen, showError, getPlayerName } from './dom.js';
import { makeCountdownRing } from './question-render.js';
import { loadPanelLeaderboard } from './leaderboard.js';
import { TEST_SPEED } from './constants.js';
import { registerHomeHandler, showRunEnded } from './home.js';

const TIMER_RING_CIRC = 175.93;
const COUNTDOWN = ['5', '4', '3', '2', '1', 'GO'];
const COUNTDOWN_STEP_MS = 1000 / TEST_SPEED;
const RESULT_DISPLAY_MS = 1600 / TEST_SPEED;
const DELTA_DISPLAY_MS = 800 / TEST_SPEED;
const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
const KIND_LABEL = { select: 'SELECT ALL', order: 'ORDER' };

let socketRef = null;
let ring = null;
let total = 6;
let timerSec = 30;
let index = -1;
let score = 0;
let live = false;
let pending = false;
let runToken = 0;
let stepTimer = null;
let capTimer = null;
let deltaTimer = null;
let slots = [];
let kind = null;
let picks = [];
const keyBtns = new Map();
const chipBtns = new Map();

function _qel(id) {
  return document.getElementById(id);
}

function _showPhase(name) {
  _qel('pokedome-phase-game').style.display = name === 'game' ? '' : 'none';
  _qel('pokedome-phase-gameover').style.display = name === 'gameover' ? '' : 'none';
}

function _ensureRing() {
  ring ??= makeCountdownRing({
    ringEl: _qel('pokedome-turn-timer'),
    labelEl: _qel('pokedome-timer-ring-label'),
    progressEl: _qel('pokedome-timer-ring-progress'),
    ringCirc: TIMER_RING_CIRC,
  });
  return ring;
}

function _clearTimers() {
  clearTimeout(stepTimer);
  clearTimeout(capTimer);
  stepTimer = null;
  capTimer = null;
  ring?.stop();
}

function _reset() {
  runToken += 1;
  _clearTimers();
  live = false;
  pending = false;
  index = -1;
  score = 0;
  _qel('pokedome-score').textContent = '0';
  _setDelta('');
}

function _setDelta(text) {
  clearTimeout(deltaTimer);
  if (text) {
    deltaTimer = setTimeout(() => _setDelta(''), DELTA_DISPLAY_MS);
  }
  const d = _qel('pokedome-score-delta');
  d.textContent = text;
  d.className = 'skipnot-score-delta';
  if (text) {
    d.classList.add('hit');
  }
}

function _setStatus(text, cls) {
  const s = _qel('pokedome-status');
  s.textContent = text;
  s.classList.toggle('solved', cls === 'solved');
  s.classList.toggle('failed', cls === 'failed');
}

function _renderKeys(locked) {
  const wrap = _qel('pokedome-keys');
  wrap.innerHTML = '';
  keyBtns.clear();
  for (const keys of KEY_ROWS) {
    const row = document.createElement('div');
    row.className = 'pokedome-key-row';
    for (const letter of keys) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pokedome-key';
      btn.textContent = letter;
      if (locked.includes(letter)) {
        btn.disabled = true;
        btn.classList.add('locked');
      }
      btn.addEventListener('click', () => _guess(letter));
      keyBtns.set(letter, btn);
      row.appendChild(btn);
    }
    wrap.appendChild(row);
  }
}

function _renderWord(pattern) {
  const wrap = _qel('pokedome-word');
  wrap.innerHTML = '';
  slots = pattern.map((c) => {
    const slot = document.createElement('span');
    slot.className = 'pokedome-slot';
    if (c) {
      slot.textContent = c;
      slot.classList.add('filled');
    }
    wrap.appendChild(slot);
    return slot;
  });
}

function _renderChips(options) {
  const wrap = _qel('pokedome-chips');
  wrap.innerHTML = '';
  chipBtns.clear();
  picks = [];
  for (const opt of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pokedome-key pokedome-chip';
    btn.textContent = opt;
    btn.addEventListener('click', () => _togglePick(opt));
    chipBtns.set(opt, btn);
    wrap.appendChild(btn);
  }
  _qel('btn-pokedome-confirm').hidden = false;
  _paintChips();
}

function _paintChips() {
  chipBtns.forEach((btn, opt) => {
    const i = picks.indexOf(opt);
    btn.classList.toggle('picked', i >= 0);
    btn.textContent = kind === 'order' && i >= 0 ? `${i + 1} · ${opt}` : opt;
  });
  _qel('btn-pokedome-confirm').disabled =
    kind === 'order' ? picks.length !== chipBtns.size : !picks.length;
}

function _togglePick(opt) {
  if (!live || pending) {
    return;
  }
  const i = picks.indexOf(opt);
  if (i >= 0) {
    picks.splice(i, 1);
  } else {
    picks.push(opt);
  }
  _setStatus('', '');
  _paintChips();
}

function _confirm() {
  if (!live || pending || _qel('btn-pokedome-confirm').disabled) {
    return;
  }
  pending = true;
  const token = runToken;
  socketRef?.emit('pokedome:submit', { index, picks: [...picks] }, (res) => {
    if (token !== runToken) {
      return;
    }
    pending = false;
    if (res?.error) {
      console.warn('[pokedome] submit rejected:', res.error);
      return;
    }
    if (res.timedOut) {
      _timedOut();
    } else if (res.solved) {
      _solved(res.points);
    } else {
      _setStatus('WRONG', 'failed');
    }
  });
}

function _skip() {
  if (!live || pending) {
    return;
  }
  pending = true;
  const token = runToken;
  socketRef?.emit('pokedome:skip', { index }, (res) => {
    if (token !== runToken) {
      return;
    }
    pending = false;
    if (res?.error) {
      console.warn('[pokedome] skip rejected:', res.error);
      showRunEnded();
      return;
    }
    if (res.timedOut) {
      _timedOut();
      return;
    }
    _setDelta('');
    _setStatus('SKIPPED', 'failed');
    _endPuzzle();
  });
}

function _disableKeys() {
  const actions = [_qel('btn-pokedome-confirm'), _qel('btn-pokedome-skip')];
  for (const b of [...keyBtns.values(), ...chipBtns.values(), ...actions]) {
    b.disabled = true;
  }
}

function _schedule(fn, ms) {
  const token = runToken;
  stepTimer = setTimeout(() => {
    if (token === runToken) {
      fn();
    }
  }, ms);
}

function _countdown(step = 0) {
  if (step >= COUNTDOWN.length) {
    _startPuzzle();
    return;
  }
  _qel('pokedome-countdown').textContent = COUNTDOWN[step];
  _qel('btn-pokedome-ready').hidden = false;
  _schedule(() => _countdown(step + 1), COUNTDOWN_STEP_MS);
}

function _startPuzzle() {
  clearTimeout(stepTimer);
  _qel('pokedome-countdown').textContent = '';
  _qel('btn-pokedome-ready').hidden = true;
  _loadPuzzle();
}

function _nextPuzzle() {
  _qel('pokedome-counter').textContent = `${index + 2}/${total}`;
  _qel('pokedome-hint').textContent = '';
  _qel('pokedome-prompt').textContent = '';
  _qel('pokedome-word').innerHTML = '';
  _qel('pokedome-keys').innerHTML = '';
  _qel('pokedome-chips').innerHTML = '';
  _qel('pokedome-actions').hidden = true;
  _qel('btn-pokedome-confirm').hidden = true;
  _setStatus('', '');
  _countdown();
}

function _loadPuzzle() {
  const token = runToken;
  socketRef?.emit('pokedome:next', (res) => {
    if (token !== runToken) {
      return;
    }
    if (res?.error) {
      console.warn('[pokedome] next failed:', res.error);
      showRunEnded();
      return;
    }
    index = res.index;
    _qel('pokedome-counter').textContent = `${index + 1}/${total}`;
    kind = res.kind;
    live = true;
    _qel('pokedome-actions').hidden = false;
    _qel('btn-pokedome-skip').disabled = false;
    if (kind === 'hangman') {
      _qel('pokedome-hint').textContent = res.hint ? `HINT: ${res.hint}` : '';
      _renderWord(res.pattern);
      _renderKeys(res.locked);
    } else {
      _qel('pokedome-prompt').textContent = res.prompt;
      _renderChips(res.options);
    }
    _ensureRing().start(timerSec);
    capTimer = setTimeout(_timedOut, timerSec * 1000);
  });
}

function _guess(letter) {
  const btn = keyBtns.get(letter);
  if (!live || pending || !btn || btn.disabled) {
    return;
  }
  pending = true;
  const token = runToken;
  socketRef?.emit('pokedome:guess', { index, letter }, (res) => {
    if (token !== runToken) {
      return;
    }
    pending = false;
    if (res?.error) {
      console.warn('[pokedome] guess rejected:', res.error);
      return;
    }
    if (res.timedOut) {
      _timedOut();
      return;
    }
    if (res.repeat) {
      return;
    }
    btn.disabled = true;
    if (res.hit) {
      btn.classList.add('hit');
      for (const i of res.positions) {
        slots[i].textContent = letter;
        slots[i].classList.add('filled');
      }
    } else {
      btn.classList.add('miss');
    }
    if (res.solved) {
      _solved(res.points);
    }
  });
}

function _endPuzzle() {
  live = false;
  _clearTimers();
  _disableKeys();
  _schedule(() => (index + 1 >= total ? _finish() : _nextPuzzle()), RESULT_DISPLAY_MS);
}

function _solved(points) {
  score += points;
  _qel('pokedome-score').textContent = String(score);
  _setDelta(`+${points}`);
  _setStatus('PUZZLE SOLVED', 'solved');
  _endPuzzle();
}

function _timedOut() {
  if (!live) {
    return;
  }
  _setDelta('');
  _setStatus('TIMED OUT', 'failed');
  _endPuzzle();
}

function _renderResults(results) {
  const wrap = _qel('pokedome-go-results');
  wrap.innerHTML = '';
  results.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'pokedome-result';
    const cells = [
      String(i + 1),
      r.solved ? (r.word ?? KIND_LABEL[r.kind]) : r.skipped ? 'SKIPPED' : 'TIMED OUT',
      r.solved ? (r.ms / 1000).toFixed(1) + 's' : '—',
      r.wrong + ' wrong',
      String(r.points),
    ];
    for (const text of cells) {
      const cell = document.createElement('span');
      cell.textContent = text;
      row.appendChild(cell);
    }
    if (!r.solved) {
      row.classList.add('timedout');
    }
    wrap.appendChild(row);
  });
}

function _finish() {
  const token = runToken;
  socketRef?.emit('pokedome:finish', (res) => {
    if (token !== runToken) {
      return;
    }
    if (res?.error) {
      console.warn('[pokedome] finish failed:', res.error);
      showRunEnded();
      return;
    }
    _qel('pokedome-go-score').textContent = String(res.score);
    _qel('pokedome-go-time').textContent = (res.timeMs / 1000).toFixed(1) + 's';
    _renderResults(res.results);
    _qel('pokedome-qualifies-row').style.display = res.qualifies ? '' : 'none';
    _qel('btn-pokedome-submit-score').style.display = res.qualifies ? '' : 'none';
    if (res.qualifies) {
      _qel('pokedome-name-input').value = '';
      setTimeout(() => _qel('pokedome-name-input').focus(), 50);
    }
    loadPanelLeaderboard('pokedome', 'pokedome-go-lb-rows');
    _showPhase('gameover');
  });
}

function _onSubmitScore() {
  const name = _qel('pokedome-name-input').value.trim();
  if (!name) {
    return;
  }
  socketRef?.emit('pokedome:submit_score', { name }, (res) => {
    if (res?.error) {
      console.warn('[pokedome] submit_score:', res.error);
      return;
    }
    _qel('pokedome-qualifies-row').style.display = 'none';
    _qel('btn-pokedome-submit-score').style.display = 'none';
    loadPanelLeaderboard('pokedome', 'pokedome-go-lb-rows');
  });
}

function _onKeydown(e) {
  if (
    !live ||
    kind !== 'hangman' ||
    e.ctrlKey ||
    e.metaKey ||
    e.altKey ||
    e.target instanceof HTMLInputElement
  ) {
    return;
  }
  const letter = e.key.toUpperCase();
  if (/^[A-Z]$/.test(letter)) {
    _guess(letter);
  }
}

function _startRun() {
  if (!getPlayerName()) {
    return;
  }
  socketRef?.emit('pokedome:start', (res) => {
    if (res?.error) {
      showError(res.error);
      return;
    }
    _reset();
    total = res.total;
    timerSec = res.timerMs / 1000;
    _showPhase('game');
    showScreen('screen-pokedome');
    _nextPuzzle();
  });
}

export function initPokedome(sock) {
  socketRef = sock;
  el('btn-pokedome-create').addEventListener('click', _startRun);
  el('btn-pokedome-submit-score').addEventListener('click', _onSubmitScore);
  el('btn-pokedome-ready').addEventListener('click', _startPuzzle);
  el('btn-pokedome-confirm').addEventListener('click', _confirm);
  el('btn-pokedome-skip').addEventListener('click', _skip);
  document.addEventListener('keydown', _onKeydown);
  registerHomeHandler({ reset: _reset });
}
