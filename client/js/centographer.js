// CentoGrapher client — single-question geography "select all related to the
// shown country". Server sends a country outline (SVG) + a grid of choices
// (correct flags hidden); player checks all that apply, submits once. Server
// scores (+5 correct / -8 wrong, cap +100, no floor) and returns a verdict for
// the player's OWN picks only — the true correct set is never revealed.

import { el, showScreen, sanitize } from './dom.js';
import { loadPanelLeaderboard } from './leaderboard.js';
import { showView } from './nav.js';

const _testSpeed = Number(new URLSearchParams(window.location.search).get('testSpeed')) || 1;
const RESULT_FLASH_MS = 1100 / _testSpeed;

let socketRef = null;
let choices = [];
let selected = new Set();
let resolved = false;
let timerInt = null;

function _qel(id) {
  return document.getElementById(id);
}

function _showPhase(name) {
  _qel('cento-phase-game').style.display = name === 'game' ? '' : 'none';
  _qel('cento-phase-gameover').style.display = name === 'gameover' ? '' : 'none';
}

function _renderChoices() {
  const wrap = _qel('cento-choices');
  wrap.innerHTML = '';
  choices.forEach((c) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cento-choice';
    btn.dataset.id = c.id;
    btn.innerHTML =
      '<span class="cento-check" aria-hidden="true"></span>' +
      '<span class="cento-label">' +
      sanitize(c.label) +
      '</span>';
    btn.addEventListener('click', () => _toggle(c.id, btn));
    wrap.appendChild(btn);
  });
}

function _toggle(id, btn) {
  if (resolved) {
    return;
  }
  if (selected.has(id)) {
    selected.delete(id);
    btn.classList.remove('checked');
  } else {
    selected.add(id);
    btn.classList.add('checked');
  }
  _qel('cento-count').textContent = String(selected.size);
}

function _stopTimer() {
  if (timerInt) {
    clearInterval(timerInt);
    timerInt = null;
  }
}

function _startTimer(totalSec) {
  _stopTimer();
  const fill = _qel('cento-timer-fill');
  const text = _qel('cento-timer-text');
  let left = totalSec;
  fill.style.width = '100%';
  fill.className = 'cento-timer-fill safe';
  text.textContent = Math.ceil(left) + 's';
  timerInt = setInterval(() => {
    left = Math.max(0, left - 0.1);
    const pct = (left / totalSec) * 100;
    fill.style.width = pct + '%';
    text.textContent = Math.ceil(left) + 's';
    fill.className = 'cento-timer-fill ' + (pct < 20 ? 'danger' : pct < 45 ? 'warn' : 'safe');
    if (left <= 0) {
      _stopTimer();
      _submit();
    }
  }, 100);
}

function _submit() {
  if (resolved) {
    return;
  }
  resolved = true;
  _stopTimer();
  _qel('btn-cento-submit').disabled = true;
  socketRef?.emit('centographer:submit', { selected: [...selected] }, (res) => {
    if (res?.error) {
      console.warn('[cento] submit failed:', res.error);
      return;
    }
    // Color the player's own picks only; unchecked stay neutral (answer hidden).
    document.querySelectorAll('#cento-choices .cento-choice').forEach((b) => {
      b.disabled = true;
      const v = res.verdict ? res.verdict[b.dataset.id] : undefined;
      if (v === true) {
        b.classList.add('correct');
      } else if (v === false) {
        b.classList.add('wrong');
      }
    });
    setTimeout(() => _showGameover(res), RESULT_FLASH_MS);
  });
}

function _showGameover(res) {
  _qel('cento-go-score').textContent = String(res.score);
  _qel('cento-go-correct').textContent = String(res.missingCorrect ?? 0);
  _qel('cento-go-wrong').textContent = String(res.wrongPicked ?? 0);
  _qel('cento-qualifies-row').style.display = res.qualifies ? '' : 'none';
  _qel('btn-cento-submit-score').style.display = res.qualifies ? '' : 'none';
  if (res.qualifies) {
    _qel('cento-name-input').value = '';
    setTimeout(() => _qel('cento-name-input').focus(), 50);
  }
  loadPanelLeaderboard('centographer', 'cento-go-lb-rows');
  _showPhase('gameover');
}

function _onSubmitScore() {
  const name = _qel('cento-name-input').value.trim();
  if (!name) {
    return;
  }
  socketRef?.emit('centographer:submit_score', { name }, (res) => {
    if (res?.error) {
      console.warn('[cento] submit_score:', res.error);
      return;
    }
    _qel('cento-qualifies-row').style.display = 'none';
    _qel('btn-cento-submit-score').style.display = 'none';
    loadPanelLeaderboard('centographer', 'cento-go-lb-rows');
  });
}

function _startRun() {
  selected = new Set();
  resolved = false;
  _qel('btn-cento-submit').disabled = false;
  _showPhase('game');
  showScreen('screen-centographer');
  socketRef?.emit('centographer:start', (res) => {
    if (res?.error) {
      console.warn('[cento] start failed:', res.error);
      _qel('cento-count').textContent = '—';
      return;
    }
    choices = res.choices || [];
    _qel('cento-img').src = '/assets/countries/' + res.slug + '.svg';
    _qel('cento-count').textContent = '0';
    _renderChoices();
    _startTimer((res.timerMs ?? 60000) / 1000);
  });
}

export function initCentographer(sock) {
  socketRef = sock;
  el('btn-cento-create').addEventListener('click', _startRun);
  el('btn-cento-submit').addEventListener('click', _submit);
  el('btn-cento-submit-score').addEventListener('click', _onSubmitScore);
  el('btn-cento-back').addEventListener('click', () => {
    showScreen('screen-connect');
    showView('play');
    import('./auth.js').then(({ checkAuth }) => checkAuth());
  });

  const lbBtn = el('btn-show-cento-lb');
  const lbPanel = el('cento-lb-panel');
  if (lbBtn && lbPanel) {
    lbBtn.addEventListener('click', () => {
      const visible = lbPanel.style.display !== 'none';
      lbPanel.style.display = visible ? 'none' : '';
      lbBtn.textContent = visible ? 'Show CentoGrapher Leaderboard' : 'Hide Leaderboard';
      if (!visible) {
        loadPanelLeaderboard('centographer', 'cento-lb-rows');
      }
    });
  }
}
