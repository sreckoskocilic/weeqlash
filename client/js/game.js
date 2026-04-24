// ============================================================
// GAME INTERACTION
// ============================================================

import { el } from './dom.js';
import { showError } from './dom.js';
import { showScreen } from './dom.js';
import { renderAll } from './render.js';
import { PHASE, COORD_BASE } from './constants.js';
import {
  getGameState,
  setGameState,
  myRoom,
  localPhase,
  setLocalPhase,
  localSelectedPegId,
  setLocalSelectedPegId,
  validMovesSet,
  setValidMovesSet,
  myPlayerIndex,
  pendingMove,
  setPendingMove,
  pendingQuestions,
  setPendingQuestions,
  pendingQuestionsTotal,
  setPendingQuestionsTotal,
  pendingAnswers,
  setPendingAnswers,
  currentQIdx,
  setCurrentQIdx,
  spectateGen,
  setSpectateGen,
  pendingCombatDefenderIdx,
  setPendingCombatDefenderIdx,
  lastSubmittedPegId,
  setLastSubmittedPegId,
  lastSubmittedMoveType,
  setLastSubmittedMoveType,
  navCursor,
  setNavCursor,
} from './state.js';

import { getSocket } from './socket.js';
import { showQuestion } from './question.js';

// Peg click handler
export function onPegClick(pegId) {
  const gameState = getGameState();
  if (!gameState || myPlayerIndex === null) {
    return;
  }
  if (gameState.currentPlayerIdx !== myPlayerIndex) {
    return;
  }
  const phase = localPhase ?? gameState.phase;
  if (phase !== PHASE.SELECT_PEG && phase !== PHASE.SELECT_TILE) {
    return;
  }
  const myPlayer = gameState.players[myPlayerIndex];
  if (!myPlayer?.pegIds.includes(pegId)) {
    return;
  }
  // Deselect current peg
  if (phase === PHASE.SELECT_TILE && pegId === localSelectedPegId) {
    setLocalSelectedPegId(null);
    setLocalPhase(PHASE.SELECT_PEG);
    setValidMovesSet(new Set());
    renderAll(gameState);
    return;
  }

  const socket = getSocket();
  socket.emit('action:select_peg', { code: myRoom?.code, pegId }, ({ ok, error, validMoves }) => {
    if (error || !ok) {
      return;
    }
    setLocalSelectedPegId(pegId);
    setLocalPhase(PHASE.SELECT_TILE);
    setValidMovesSet(new Set(validMoves));
    renderAll(gameState);
  });
}

// Tile click handler
export function onTileClick(r, c) {
  const gameState = getGameState();
  if (!gameState || myPlayerIndex === null) {
    return;
  }
  if (gameState.currentPlayerIdx !== myPlayerIndex) {
    return;
  }
  const phase = localPhase ?? gameState.phase;
  if (phase !== PHASE.SELECT_TILE) {
    return;
  }
  if (!localSelectedPegId) {
    return;
  }
  const coord = r * COORD_BASE + c;
  if (!validMovesSet.has(coord)) {
    return;
  }

  const defPegId = gameState.board[r]?.[c]?.pegId;
  if (defPegId && gameState.pegs[defPegId]?.playerId !== myPlayerIndex) {
    setPendingCombatDefenderIdx(gameState.pegs[defPegId].playerId);
  } else {
    setPendingCombatDefenderIdx(null);
  }

  const socket = getSocket();
  socket.emit(
    'action:select_tile',
    { code: myRoom?.code, pegId: localSelectedPegId, r, c },
    ({ ok, error, moveType, question, questionsTotal, defenderPlayerIdx }) => {
      if (error || !ok) {
        return;
      }
      if (defenderPlayerIdx !== undefined) {
        setPendingCombatDefenderIdx(defenderPlayerIdx);
      }
      setLocalPhase('answering');
      setPendingMove({
        pegId: localSelectedPegId,
        targetR: r,
        targetC: c,
        moveType,
      });
      setPendingQuestions(question ? [question] : []);
      setPendingQuestionsTotal(questionsTotal ?? 1);
      setPendingAnswers([]);
      setCurrentQIdx(0);
      setSpectateGen(spectateGen + 1);
      showQuestion(0);
    },
  );
}

// Submit turn
export function submitTurn() {
  const lastAnswer = pendingAnswers[pendingAnswers.length - 1];
  setLastSubmittedPegId(pendingMove?.pegId ?? lastSubmittedPegId);
  setLastSubmittedMoveType(pendingMove?.moveType ?? lastSubmittedMoveType);

  const socket = getSocket();
  socket.emit(
    'turn:submit',
    {
      code: myRoom?.code,
      submission: {
        pegId: pendingMove.pegId,
        targetR: pendingMove.targetR,
        targetC: pendingMove.targetC,
        answerIdx: lastAnswer?.answerIdx ?? -1,
      },
    },
    ({ error }) => {
      if (error) {
        console.error('submit:', error);
        showError(error);
        // Recover UI state
        setLocalPhase(null);
        setLocalSelectedPegId(null);
        setValidMovesSet(new Set());
        setPendingMove(null);
        setPendingQuestions([]);
        setPendingAnswers([]);
        import('./question.js').then(({ stopTimer }) => stopTimer());
        el('modal-overlay').classList.remove('visible');
      }
    },
  );

  setLocalSelectedPegId(null);
  setValidMovesSet(new Set());
  setLocalPhase('answering');
}

// Turn announcement
export function showTurnAnnounce(player, isMe) {
  const container = el('turn-announce');
  if (!container) {
    return;
  }
  const nameEl = el('turn-announce-name');
  const subEl = el('turn-announce-sub');
  nameEl.textContent = player.name;
  nameEl.style.color = player.color;
  subEl.textContent = isMe ? 'YOUR TURN' : 'THEIR TURN';
  container.classList.add('visible');
  setTimeout(() => container.classList.remove('visible'), 2000);
}

// Navigation cursor
export function initNavCursor(state) {
  const cp = state.players[state.currentPlayerIdx];
  const firstPegId = cp?.pegIds?.[0];
  if (firstPegId) {
    const peg = state.pegs[firstPegId];
    if (peg) {
      setNavCursor({ row: peg.row, col: peg.col });
    }
  }
}

export function setNavCursorToPeg(state, pegId) {
  const peg = pegId ? state.pegs?.[pegId] : null;
  if (!peg) {
    return false;
  }
  const changed = navCursor.row !== peg.row || navCursor.col !== peg.col;
  setNavCursor({ row: peg.row, col: peg.col });
  return changed;
}

// Initialize board for external use
export { initBoard } from './render.js';
