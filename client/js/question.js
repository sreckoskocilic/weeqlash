// ============================================================
// QUESTION MODAL
// ============================================================

import { el } from './dom.js';
import { sanitize } from './dom.js';
import { CAT_NAMES, CAT_COLORS, TIMING, OPTION_KEYS } from './constants.js';
import { state } from './state.js';

let gameModalOptionBtns = [];
export { gameModalOptionBtns };

export function getGameModalOptionBtns() {
  return gameModalOptionBtns;
}

export function getPendingQuestions() {
  return state.pendingQuestions;
}

export function getCurrentQIdx() {
  return state.currentQIdx;
}

export function setCurrentQIdx(idx) {
  state.currentQIdx = idx;
}

export function getTimerInterval() {
  return timerInterval;
}

let timerInterval = null;

// Show question
export function showQuestion(idx) {
  const q = state.pendingQuestions[idx];
  if (!q) {return;}

  const activeIdx = state.spectatingQuestion ? state.spectatingPlayerIdx : state.myPlayerIndex;
  const gameState = state.gameState;
  const player = gameState?.players[activeIdx];
  const catColor = CAT_COLORS[q.category] ?? '#0f3460';
  const catName = CAT_NAMES[q.category] ?? 'Question';
  const moveType = state.spectatingQuestion
    ? state.spectatingMoveType
    : state.pendingMove?.moveType;

  el('modal-cat-badge').textContent = catName;
  el('modal-cat-badge').style.background = catColor;
  el('modal').style.borderTopColor = player?.color ?? '#444';

  const playerLabel = el('modal-player-label');
  const combatLabel = el('modal-combat-label');
  if (moveType === 'combat') {
    const defIdx = state.spectatingQuestion
      ? state.spectatingDefenderIdx
      : state.pendingCombatDefenderIdx;
    const defPlayer = defIdx !== null ? gameState?.players[defIdx] : null;
    combatLabel.style.display = '';
    combatLabel.style.color = player?.color ?? '';
    combatLabel.textContent =
      idx === 0
        ? `⚔ COMBAT — ${player?.name} attacks ${defPlayer?.name ?? '?'} (Q1/${state.pendingQuestionsTotal})`
        : `⚔ COMBAT — ${player?.name} attacks (Q${idx + 1}/${state.pendingQuestionsTotal})`;
    playerLabel.style.display = 'none';
  } else if (moveType === 'flag') {
    combatLabel.style.display = '';
    combatLabel.style.color = player?.color ?? '';
    combatLabel.textContent = `⚑ FLAG CAPTURE — ${player?.name} (Q${idx + 1}/3)`;
    playerLabel.style.display = 'none';
  } else {
    combatLabel.style.display = 'none';
    playerLabel.style.display = '';
    playerLabel.style.color = player?.color ?? '';
    playerLabel.textContent = player?.name ?? '';
  }

  el('modal-question').textContent = q.q;

  const optContainer = el('modal-options');
  optContainer.innerHTML = '';
  delete optContainer.dataset.submitting;
  gameModalOptionBtns = [];
  q.opts.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'modal-option';
    btn.innerHTML = `<span class="option-key">${OPTION_KEYS[i]}</span>${sanitize(opt)}`;
    if (state.spectatingQuestion) {
      btn.disabled = true;
    } else {
      btn.onclick = () => onAnswer(i, idx);
    }
    optContainer.appendChild(btn);
    gameModalOptionBtns.push(btn);
  });

  el('modal-continue-wrap').style.display = 'none';
  el('modal-continue-btn').disabled = false;
  el('modal-continue-btn').textContent = 'CONTINUE';
  el('modal-overlay').classList.add('visible');

  if (state.spectatingQuestion) {
    el('timer-fill').style.display = 'none';
    el('timer-text').textContent = '…';
  } else {
    el('timer-fill').style.display = '';
    startTimer(idx);
    gameModalOptionBtns[0]?.focus();
  }
}

// Answer handler
export async function onAnswer(chosenIdx, qIdx) {
  if (chosenIdx < 0 || chosenIdx > 3) {
    console.error('Invalid answer index:', chosenIdx);
    return;
  }

  if (el('modal-options')?.dataset?.submitting === 'true') {
    return;
  }
  el('modal-options').dataset.submitting = 'true';

  stopTimer();
  const q = state.pendingQuestions[qIdx];
  if (!q) {
    console.error('Question not found at index:', qIdx);
    return;
  }
  const correct = chosenIdx === q.correctIdx;
  state.pendingAnswers.push({ questionId: q.id, answerIdx: chosenIdx });
  state.pendingAnswers = [...state.pendingAnswers];

  const { getSocket } = await import('./socket.js');
  const socket = getSocket();
  socket.emit('turn:answer_preview', {
    code: state.myRoom?.code,
    questionIdx: qIdx,
    answerIdx: chosenIdx,
  });

  const isCombat = state.pendingMove?.moveType === 'combat';
  const isFlag = state.pendingMove?.moveType === 'flag';
  const isLastQuestion = qIdx === state.pendingQuestions.length - 1;

  // Disable buttons
  gameModalOptionBtns.forEach((btn) => {
    btn.disabled = true;
  });

  // Highlight outcome
  gameModalOptionBtns.forEach((btn, i) => {
    if (i === q.correctIdx && state.spectatingQuestion) {
      btn.classList.add('answer-correct');
    }
    if (i === chosenIdx) {
      btn.classList.add(correct ? 'answer-correct' : 'answer-wrong');
    }
  });

  const { submitTurn } = await import('./game.js');
  if (isCombat || isFlag) {
    el('modal-continue-wrap').style.display = 'none';
    if (!correct) {
      setTimeout(() => submitTurn(), TIMING.WRONG_ANSWER_DELAY_MS);
    } else if (!isLastQuestion) {
      setTimeout(() => submitTurn(), TIMING.ANSWER_DELAY_MS);
    } else {
      setTimeout(() => submitTurn(), TIMING.ANSWER_DELAY_MS);
    }
  } else {
    el('modal-continue-wrap').style.display = 'block';
  }
}

// Continue after question
export function continueAfterQuestion() {
  if (!state.pendingMove) {
    return;
  }
  el('modal-continue-btn').disabled = true;
  state.lastSubmittedPegId = state.pendingMove?.pegId ?? null;
  state.localSelectedPegId = null;
  state.localPhase = 'answering';
  state.validMovesSet = new Set();
  el('modal-overlay').classList.remove('visible');

  import('./render.js')
    .then(({ renderAll }) => {
      if (state.gameState) {renderAll(state.gameState);}
    })
    .then(() => {
      import('./game.js').then(({ submitTurn }) => submitTurn());
    });
}

// Timer
export function startTimer(qIdx) {
  stopTimer();
  const fill = el('timer-fill');
  const text = el('timer-text');
  let remaining = state.timerDuration;
  fill.style.width = '100%';
  fill.className = 'timer-bar-fill safe';
  text.textContent = state.timerDuration + 's';

  timerInterval = setInterval(() => {
    remaining -= 0.1;
    const pct = Math.max(0, (remaining / state.timerDuration) * 100);
    fill.style.width = pct + '%';
    text.textContent = Math.ceil(remaining) + 's';
    if (pct < TIMING.TIMER_DANGER_PCT) {
      fill.className = 'timer-bar-fill danger';
    } else if (pct < TIMING.TIMER_WARNING_PCT) {
      fill.className = 'timer-bar-fill warning';
    }
    if (remaining <= 0) {
      stopTimer();
      const tq = state.pendingQuestions[qIdx];
      if (!tq) {
        return;
      }
      gameModalOptionBtns.forEach((btn) => {
        btn.disabled = true;
      });
      state.pendingAnswers.push({ questionId: tq.id, answerIdx: -1 });

      import('./game.js').then(({ submitTurn }) => {
        if (state.pendingMove?.moveType === 'combat' || state.pendingMove?.moveType === 'flag') {
          submitTurn();
        } else {
          el('modal-continue-wrap').style.display = 'block';
        }
      });
    }
  }, TIMING.TICK_INTERVAL_MS);
}

export function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

export function initQuestion() {
  el('modal-continue-btn').addEventListener('click', continueAfterQuestion);
}
