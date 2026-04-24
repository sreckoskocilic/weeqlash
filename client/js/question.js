// ============================================================
// QUESTION MODAL
// ============================================================

import { el } from './dom.js';
import { sanitize } from './dom.js';
import { CAT_NAMES, CAT_COLORS, TIMING, OPTION_KEYS } from './constants.js';
import {
  getGameState,
  myPlayerIndex,
  pendingMove,
  pendingQuestions,
  pendingQuestionsTotal,
  pendingAnswers,
  currentQIdx,
  spectatingQuestion,
  spectatingMoveType,
  spectatingPlayerIdx,
  spectatingDefenderIdx,
  pendingCombatDefenderIdx,
  lastSubmittedPegId,
  lastSubmittedMoveType,
  timerDuration,
} from './state.js';
import {
  setLocalSelectedPegId,
  setValidMovesSet,
  setLocalPhase,
  setLastSubmittedPegId,
  setLastSubmittedMoveType,
  setPendingAnswers,
} from './state.js';

let gameModalOptionBtns = [];
export { gameModalOptionBtns };

export function getGameModalOptionBtns() {
  return gameModalOptionBtns;
}

export function getPendingQuestions() {
  return pendingQuestions;
}

export function getCurrentQIdx() {
  return currentQIdx;
}

export function setCurrentQIdx(idx) {
  currentQIdx = idx;
}

export function getTimerInterval() {
  return timerInterval;
}

let timerInterval = null;

// Show question
export function showQuestion(idx) {
  const q = pendingQuestions[idx];
  if (!q) return;

  const activeIdx = spectatingQuestion ? spectatingPlayerIdx : myPlayerIndex;
  const state = getGameState();
  const player = state?.players[activeIdx];
  const catColor = CAT_COLORS[q.category] ?? '#0f3460';
  const catName = CAT_NAMES[q.category] ?? 'Question';
  const moveType = spectatingQuestion ? spectatingMoveType : pendingMove?.moveType;

  el('modal-cat-badge').textContent = catName;
  el('modal-cat-badge').style.background = catColor;
  el('modal').style.borderTopColor = player?.color ?? '#444';

  const playerLabel = el('modal-player-label');
  const combatLabel = el('modal-combat-label');
  if (moveType === 'combat') {
    const defIdx = spectatingQuestion ? spectatingDefenderIdx : pendingCombatDefenderIdx;
    const defPlayer = defIdx !== null ? state?.players[defIdx] : null;
    combatLabel.style.display = '';
    combatLabel.style.color = player?.color ?? '';
    combatLabel.textContent =
      idx === 0
        ? `⚔ COMBAT — ${player?.name} attacks ${defPlayer?.name ?? '?'} (Q1/${pendingQuestionsTotal})`
        : `⚔ COMBAT — ${player?.name} attacks (Q${idx + 1}/${pendingQuestionsTotal})`;
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
    if (spectatingQuestion) {
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

  if (spectatingQuestion) {
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
  const q = pendingQuestions[qIdx];
  if (!q) {
    console.error('Question not found at index:', qIdx);
    return;
  }
  const correct = chosenIdx === q.correctIdx;
  pendingAnswers.push({ questionId: q.id, answerIdx: chosenIdx });
  setPendingAnswers([...pendingAnswers]);

  const { getSocket } = await import('./socket.js');
  const socket = getSocket();
  const { myRoom } = await import('./state.js');
  socket.emit('turn:answer_preview', {
    code: myRoom?.code,
    questionIdx: qIdx,
    answerIdx: chosenIdx,
  });

  const isCombat = pendingMove?.moveType === 'combat';
  const isFlag = pendingMove?.moveType === 'flag';
  const isLastQuestion = qIdx === pendingQuestions.length - 1;

  // Disable buttons
  gameModalOptionBtns.forEach((btn) => {
    btn.disabled = true;
  });

  // Highlight outcome
  gameModalOptionBtns.forEach((btn, i) => {
    if (i === q.correctIdx && spectatingQuestion) {
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
  if (!pendingMove) {
    return;
  }
  el('modal-continue-btn').disabled = true;
  setLastSubmittedPegId(pendingMove?.pegId ?? null);
  setLocalSelectedPegId(null);
  setLocalPhase('answering');
  setValidMovesSet(new Set());
  el('modal-overlay').classList.remove('visible');

  import('./render.js')
    .then(({ renderAll }) => {
      const state = getGameState();
      if (state) renderAll(state);
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
  let remaining = timerDuration;
  fill.style.width = '100%';
  fill.className = 'timer-bar-fill safe';
  text.textContent = timerDuration + 's';

  timerInterval = setInterval(() => {
    remaining -= 0.1;
    const pct = Math.max(0, (remaining / timerDuration) * 100);
    fill.style.width = pct + '%';
    text.textContent = Math.ceil(remaining) + 's';
    if (pct < TIMING.TIMER_DANGER_PCT) {
      fill.className = 'timer-bar-fill danger';
    } else if (pct < TIMING.TIMER_WARNING_PCT) {
      fill.className = 'timer-bar-fill warning';
    }
    if (remaining <= 0) {
      stopTimer();
      const tq = pendingQuestions[qIdx];
      if (!tq) {
        return;
      }
      gameModalOptionBtns.forEach((btn) => {
        btn.disabled = true;
      });
      pendingAnswers.push({ questionId: tq.id, answerIdx: -1 });

      import('./game.js').then(({ submitTurn }) => {
        if (pendingMove?.moveType === 'combat' || pendingMove?.moveType === 'flag') {
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

// Expose on window for onclick
window.continueAfterQuestion = continueAfterQuestion;
