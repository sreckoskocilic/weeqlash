import { el, showScreen, sanitize } from './dom.js';
import { renderQuestion, makeCountdownRing } from './question-render.js';
import { showView } from './nav.js';

const TIMER_RING_CIRC = 175.93;
const _testSpeed = Number(new URLSearchParams(window.location.search).get('testSpeed')) || 1;
const RESULT_DISPLAY_MS = 800 / _testSpeed;
const POINT_CORRECT = 2;
const POINT_WRONG = -2;

let socketRef = null;
let ring = null;
let questions = [];
let total = 10;
let timerSec = 7;
let currentIdx = 0;
let score = 0;
let optionBtns = [];
let resolvedThisQ = false;
let questionTimeout = null;
let runStartedAt = 0;
let outcomes = [];
let scoreAnimRaf = null;
let diceValues = null;
let diceAccepted = null;

function _qel(id) {
  return document.getElementById(id);
}

function _showPhase(name) {
  for (const p of ['game', 'dice', 'gowild', 'gameover']) {
    const phaseEl = _qel('howhigh-phase-' + p);
    if (phaseEl) {
      phaseEl.style.display = p === name ? '' : 'none';
    }
  }
}

function _resetRun() {
  questions = [];
  currentIdx = 0;
  score = 0;
  total = 10;
  timerSec = 7;
  optionBtns = [];
  resolvedThisQ = false;
  outcomes = [];
  diceValues = null;
  diceAccepted = null;
  if (questionTimeout) {
    clearTimeout(questionTimeout);
    questionTimeout = null;
  }
  if (scoreAnimRaf) {
    cancelAnimationFrame(scoreAnimRaf);
    scoreAnimRaf = null;
  }
  runStartedAt = Date.now();
  _qel('howhigh-score').textContent = '0';
  _qel('howhigh-counter').textContent = '0/' + total;
  const d = _qel('howhigh-score-delta');
  if (d) {
    d.textContent = '';
    d.className = 'skipnot-score-delta';
  }
  _resetProgressDots();
}

function _resetProgressDots() {
  const wrap = _qel('howhigh-progress');
  if (!wrap) {
    return;
  }
  const html = [];
  for (let i = 0; i < total; i++) {
    html.push('<span class="pdot' + (i === 0 ? ' now' : '') + '" data-i="' + i + '"></span>');
  }
  wrap.innerHTML = html.join('');
}

function _rebuildProgressDots() {
  const wrap = _qel('howhigh-progress');
  if (!wrap) {
    return;
  }
  const html = [];
  for (let i = 0; i < total; i++) {
    const o = outcomes[i];
    let cls = 'pdot';
    if (o === 'ok') {
      cls += ' ok';
    } else if (o === 'bad') {
      cls += ' bad';
    } else if (i === currentIdx) {
      cls += ' now';
    }
    html.push('<span class="' + cls + '" data-i="' + i + '"></span>');
  }
  wrap.innerHTML = html.join('');
}

function _updateProgressDot(idx, state) {
  const wrap = _qel('howhigh-progress');
  if (!wrap) {
    return;
  }
  const dot = wrap.querySelector('.pdot[data-i="' + idx + '"]');
  if (dot) {
    dot.className = 'pdot';
    if (state === 'ok') {
      dot.classList.add('ok');
    } else if (state === 'bad') {
      dot.classList.add('bad');
    }
  }
  const next = wrap.querySelector('.pdot[data-i="' + (idx + 1) + '"]');
  if (next) {
    next.classList.add('now');
  }
}

function _animateScore(from, target) {
  const scoreEl = _qel('howhigh-score');
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
      ringEl: _qel('howhigh-turn-timer'),
      labelEl: _qel('howhigh-timer-ring-label'),
      progressEl: _qel('howhigh-timer-ring-progress'),
      ringCirc: TIMER_RING_CIRC,
    });
  }
  return ring;
}

let _deltaTimeout = null;
function _flash(outcome, delta) {
  const d = _qel('howhigh-score-delta');
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

function _calcDelta(correct) {
  if (currentIdx === 3 && diceAccepted) {
    const diceSum = diceValues.die1 + diceValues.die2;
    return correct ? POINT_CORRECT + diceSum : POINT_WRONG - Math.ceil(diceSum / 2);
  }
  return correct ? POINT_CORRECT : POINT_WRONG;
}

function _renderCurrentQ() {
  resolvedThisQ = false;
  const q = questions[currentIdx];
  if (!q) {
    return;
  }
  _qel('howhigh-counter').textContent = currentIdx + 1 + '/' + total;
  renderQuestion(
    {
      questionEl: _qel('howhigh-question'),
      optionsEl: _qel('howhigh-options'),
    },
    q,
    currentIdx,
    _onOptionClick,
    { showCategory: false },
  );
  optionBtns = Array.from(_qel('howhigh-options').querySelectorAll('button'));
  _ensureRing().start(timerSec);
  if (questionTimeout) {
    clearTimeout(questionTimeout);
  }
  questionTimeout = setTimeout(_onTimeout, timerSec * 1000);
}

function _advanceAfterDelay() {
  setTimeout(() => {
    currentIdx += 1;
    if (currentIdx >= total) {
      _finishRun();
    } else {
      _renderCurrentQ();
    }
  }, RESULT_DISPLAY_MS);
}

function _checkNextEvent(nextEvent) {
  if (nextEvent === 'dice_offer') {
    currentIdx += 1;
    ring?.stop();
    if (questionTimeout) {
      clearTimeout(questionTimeout);
      questionTimeout = null;
    }
    setTimeout(() => _showDiceOffer(), RESULT_DISPLAY_MS);
    return true;
  }
  if (nextEvent === 'gowild_offer') {
    currentIdx += 1;
    ring?.stop();
    if (questionTimeout) {
      clearTimeout(questionTimeout);
      questionTimeout = null;
    }
    setTimeout(() => _showGoWildOffer(), RESULT_DISPLAY_MS);
    return true;
  }
  return false;
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
  socketRef?.emit('howhigh:answer', { id: q.id, optionIdx: idx }, (res) => {
    if (res?.error) {
      console.warn('[howhigh] answer rejected:', res.error);
      resolvedThisQ = false;
      optionBtns.forEach((b) => {
        b.disabled = false;
      });
      _ensureRing().start(timerSec);
      questionTimeout = setTimeout(_onTimeout, timerSec * 1000);
      return;
    }
    const correct = !!res.correct;
    const delta = _calcDelta(correct);
    const prevScore = score;
    score += delta;
    _animateScore(prevScore, score);
    if (optionBtns[idx]) {
      optionBtns[idx].classList.add(correct ? 'correct' : 'wrong');
    }
    outcomes.push(correct ? 'ok' : 'bad');
    _updateProgressDot(currentIdx, correct ? 'ok' : 'bad');
    _flash(correct ? 'correct' : 'wrong', delta);

    if (!_checkNextEvent(res.nextEvent)) {
      _advanceAfterDelay();
    }
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
  const q = questions[currentIdx];
  socketRef?.emit('howhigh:timeout', { id: q.id }, (res) => {
    if (res?.error) {
      console.warn('[howhigh] timeout rejected:', res.error);
    }
    const delta = _calcDelta(false);
    const prevScore = score;
    score += delta;
    _animateScore(prevScore, score);
    outcomes.push('bad');
    _updateProgressDot(currentIdx, 'bad');
    _flash('timeout', delta);

    if (!_checkNextEvent(res?.nextEvent)) {
      _advanceAfterDelay();
    }
  });
}

// --- Dice offer ---

function _showDiceOffer() {
  _showPhase('dice');
  const die1El = _qel('howhigh-die1');
  const die2El = _qel('howhigh-die2');
  const infoEl = _qel('howhigh-dice-info');

  die1El.textContent = '?';
  die2El.textContent = '?';
  die1El.classList.add('rolling');
  die2El.classList.add('rolling');
  infoEl.innerHTML = '';

  let rollCount = 0;
  const rollInterval = setInterval(() => {
    die1El.textContent = String(Math.floor(Math.random() * 6) + 1);
    die2El.textContent = String(Math.floor(Math.random() * 6) + 1);
    rollCount++;
    if (rollCount >= 10 / _testSpeed) {
      clearInterval(rollInterval);
      die1El.classList.remove('rolling');
      die2El.classList.remove('rolling');
      die1El.textContent = String(diceValues.die1);
      die2El.textContent = String(diceValues.die2);
      const diceSum = diceValues.die1 + diceValues.die2;
      infoEl.innerHTML =
        'Sum: <strong>' +
        diceSum +
        '</strong><br>' +
        'Correct next Q: <span style="color:#4caf50">+' +
        (2 + diceSum) +
        '</span> · Wrong: <span style="color:#f44336">−' +
        (2 + Math.ceil(diceSum / 2)) +
        '</span>';
    }
  }, 100 * _testSpeed);
}

function _onDiceAccept() {
  diceAccepted = true;
  socketRef?.emit('howhigh:dice_respond', { accept: true }, (res) => {
    if (res?.error) {
      console.warn('[howhigh] dice_respond error:', res.error);
      return;
    }
    if (res.dice) {
      diceValues = res.dice;
    }
    _showPhase('game');
    _renderCurrentQ();
  });
}

function _onDiceDecline() {
  diceAccepted = false;
  socketRef?.emit('howhigh:dice_respond', { accept: false }, (res) => {
    if (res?.error) {
      console.warn('[howhigh] dice_respond error:', res.error);
      return;
    }
    _showPhase('game');
    _renderCurrentQ();
  });
}

// --- GoWild offer ---

function _showGoWildOffer() {
  _showPhase('gowild');
}

function _onGoWildAccept() {
  socketRef?.emit('howhigh:gowild_respond', { accept: true }, (res) => {
    if (res?.error) {
      console.warn('[howhigh] gowild_respond error:', res.error);
      return;
    }
    if (res.extraQuestions) {
      questions.push(...res.extraQuestions);
    }
    total = res.totalQuestions || 12;
    timerSec = (res.timerMs || 5000) / 1000;
    _qel('howhigh-counter').textContent = currentIdx + 1 + '/' + total;
    _rebuildProgressDots();
    _showPhase('game');
    _renderCurrentQ();
  });
}

function _onGoWildDecline() {
  socketRef?.emit('howhigh:gowild_respond', { accept: false }, (res) => {
    if (res?.error) {
      console.warn('[howhigh] gowild_respond error:', res.error);
      return;
    }
    _showPhase('game');
    _renderCurrentQ();
  });
}

// --- Finish ---

function _renderHeatmap() {
  const wrap = _qel('howhigh-heatmap');
  if (!wrap) {
    return;
  }
  wrap.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const o = outcomes[i];
    const ch = o === 'ok' ? '✓' : o === 'bad' ? '✕' : '';
    const cell = document.createElement('div');
    cell.className = 'hcell';
    if (o === 'ok') {
      cell.classList.add('ok');
    } else if (o === 'bad') {
      cell.classList.add('bad');
    }
    cell.textContent = ch;
    cell.title = 'Q' + (i + 1) + ': ' + (o === 'ok' ? 'Correct' : 'Wrong');
    cell.style.animationDelay = i * 40 + 'ms';
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
  socketRef?.emit('howhigh:finish', { totalMs }, (res) => {
    if (res?.error) {
      console.warn('[howhigh] finish failed:', res.error);
      return;
    }
    _qel('howhigh-go-score').textContent = String(res.score);
    _renderHeatmap();

    const codeRow = _qel('howhigh-challenge-code-row');
    const resultRow = _qel('howhigh-go-result-row');
    const winnerRow = _qel('howhigh-go-winner-row');

    if (res.result) {
      // Player 2 — show head-to-head
      codeRow.style.display = 'none';
      resultRow.style.display = '';
      winnerRow.style.display = '';
      _qel('howhigh-go-opponent-score').textContent = String(res.result.p1Score);
      const youWon = !!res.result.youWon;
      _qel('howhigh-go-winner').textContent = youWon ? 'YOU WIN!' : 'YOU LOSE';
      _qel('howhigh-go-winner').style.color = youWon ? '#4caf50' : '#f44336';
      _qel('howhigh-go-heading').textContent = '> HOWHIGH COMPLETE';
    } else {
      // Player 1 — show challenge code
      codeRow.style.display = '';
      resultRow.style.display = 'none';
      winnerRow.style.display = 'none';
      _qel('howhigh-challenge-code').textContent = res.challengeCode;
      _qel('howhigh-go-heading').textContent = '> HOWHIGH COMPLETE';
    }

    _showPhase('gameover');
  });
}

// --- Start / Join ---

function _startRun() {
  _resetRun();
  _showPhase('game');
  showScreen('screen-howhigh');
  socketRef?.emit('howhigh:start', (res) => {
    if (res?.error) {
      console.warn('[howhigh] start failed:', res.error);
      _qel('howhigh-question').innerHTML =
        '<div class="qlas-q-text">' + sanitize(res.error) + '</div>';
      return;
    }
    questions = res.questions || [];
    total = res.total ?? questions.length;
    timerSec = (res.timerMs ?? 7000) / 1000;
    if (res.dice) {
      diceValues = res.dice;
    }
    runStartedAt = Date.now();
    _resetProgressDots();
    _renderCurrentQ();
  });
}

function _joinRun() {
  const input = _qel('howhigh-join-code');
  const code = input?.value?.trim()?.toUpperCase();
  if (!code || code.length !== 5) {
    return;
  }

  _resetRun();
  _showPhase('game');
  showScreen('screen-howhigh');
  socketRef?.emit('howhigh:join', { code }, (res) => {
    if (res?.error) {
      console.warn('[howhigh] join failed:', res.error);
      _qel('howhigh-question').innerHTML =
        '<div class="qlas-q-text">' + sanitize(res.error) + '</div>';
      return;
    }
    questions = res.questions || [];
    total = res.total ?? questions.length;
    timerSec = (res.timerMs ?? 7000) / 1000;
    if (res.dice) {
      diceValues = res.dice;
    }
    runStartedAt = Date.now();
    _resetProgressDots();
    _renderCurrentQ();
  });
}

// --- Challenges tab ---

function _loadChallenges() {
  socketRef?.emit('howhigh:my_challenges', (res) => {
    if (res?.error) {
      console.warn('[howhigh] my_challenges failed:', res.error);
      return;
    }
    const list = _qel('howhigh-challenges-list');
    const empty = _qel('howhigh-challenges-empty');
    if (!list) {
      return;
    }

    const challenges = res.challenges || [];
    if (challenges.length === 0) {
      list.innerHTML = '';
      if (empty) {
        empty.style.display = '';
      }
      return;
    }
    if (empty) {
      empty.style.display = 'none';
    }

    list.innerHTML = challenges
      .map((c) => {
        const statusClass = 'hh-status-' + c.status;
        const statusText =
          c.status === 'waiting'
            ? 'Waiting for opponent'
            : c.status === 'complete'
              ? 'Complete'
              : c.status === 'active'
                ? 'In progress'
                : c.status === 'pending'
                  ? 'Your turn'
                  : c.status;
        const opponent = c.isP1 ? c.p2Name || '—' : c.p1Name;
        const yourScore = c.isP1 ? c.p1Score : c.p2Score;
        const theirScore = c.isP1 ? c.p2Score : c.p1Score;
        const date = new Date(c.createdAt).toLocaleDateString();

        if (c.status === 'complete') {
          const won = !!c.youWon;
          return (
            '<div class="hh-row ' +
            (won ? 'hh-w' : 'hh-l') +
            '">' +
            '<span class="hh-col-left"><span class="hh-badge">' +
            (won ? 'W' : 'L') +
            '</span>' +
            sanitize(opponent) +
            '</span>' +
            '<span class="hh-col-center">' +
            yourScore +
            ' <span class="hh-sep">:</span> ' +
            theirScore +
            '</span>' +
            '<span class="hh-col-right">' +
            date +
            '</span>' +
            '</div>'
          );
        }
        if (c.status === 'waiting' && c.isP1) {
          return (
            '<div class="hh-row hh-row--waiting">' +
            '<span class="hh-waiting-label">Waiting for opponent</span>' +
            '<span class="hh-code-share">' +
            c.code +
            '</span>' +
            '<span class="hh-date">' +
            date +
            '</span>' +
            '</div>'
          );
        }
        return (
          '<div class="hh-row hh-row--pending">' +
          '<span class="hh-opponent">' +
          sanitize(opponent || '—') +
          '</span>' +
          '<span class="hh-status ' +
          statusClass +
          '">' +
          statusText +
          '</span>' +
          '<span class="hh-date">' +
          date +
          '</span>' +
          '</div>'
        );
      })
      .join('');
  });
}

function _onCopyCode() {
  const code = _qel('howhigh-challenge-code')?.textContent;
  if (!code) {
    return;
  }
  navigator.clipboard.writeText(code).then(() => {
    const btn = _qel('btn-howhigh-copy-code');
    if (btn) {
      btn.textContent = 'COPIED!';
      setTimeout(() => {
        btn.textContent = 'COPY';
      }, 1500);
    }
  });
}

function _goBack() {
  showScreen('screen-connect');
  showView('play');
  import('./auth.js').then(({ checkAuth }) => checkAuth());
}

// --- Public init ---

export function initHowHigh(sock) {
  socketRef = sock;

  el('btn-howhigh-create').addEventListener('click', _startRun);
  el('btn-howhigh-join').addEventListener('click', _joinRun);
  el('btn-howhigh-back').addEventListener('click', _goBack);
  el('btn-howhigh-copy-code').addEventListener('click', _onCopyCode);
  el('btn-howhigh-dice-accept').addEventListener('click', _onDiceAccept);
  el('btn-howhigh-dice-decline').addEventListener('click', _onDiceDecline);
  el('btn-howhigh-gowild-accept').addEventListener('click', _onGoWildAccept);
  el('btn-howhigh-gowild-decline').addEventListener('click', _onGoWildDecline);

  // Load challenges when the Challenges tab is shown
  const nav = document.getElementById('connect-nav');
  if (nav) {
    nav.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-view="challenges"]');
      if (btn) {
        _loadChallenges();
      }
    });
  }

  // Allow Enter key in join code input
  const joinInput = el('howhigh-join-code');
  if (joinInput) {
    joinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        _joinRun();
      }
    });
  }
}
