// ============================================================
// KEYBOARD MODULE
// ============================================================

import { el } from './dom.js';
import { PHASE, OPTION_KEYS } from './constants.js';
import {
  getGameState,
  getMyPlayerIndex,
  getLocalPhase,
  getNavCursor,
  getSpectatingQuestion,
  setNavCursor,
} from './state.js';
import {
  getGameModalOptionBtns,
  stopTimer,
  getPendingQuestions,
  getCurrentQIdx,
  setCurrentQIdx,
  continueAfterQuestion,
} from './question.js';

// KEY_MAP for answer shortcuts
const KEY_MAP = { a: 0, b: 1, c: 2, d: 3 };

// Navigation directions
const NAV_DIRS = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

export function initKeyboard() {
  document.addEventListener('keydown', handleKey);
}

function handleKey(e) {
  const modalVisible = el('modal-overlay').classList.contains('visible');

  if (modalVisible) {
    // Answer selection shortcuts
    const key = e.key.toLowerCase();
    if (key in KEY_MAP) {
      const idx = KEY_MAP[key];
      const btns = getGameModalOptionBtns();
      if (btns[idx] && !btns[idx].disabled) {
        btns[idx].click();
      }
    }
    // Continue on Enter
    if (e.key === 'Enter' && el('modal-continue-wrap').style.display !== 'none') {
      continueAfterQuestion();
    }
    // Arrow key option cycling (only when answering, not spectating)
    if (
      !getSpectatingQuestion() &&
      (e.key === 'ArrowDown' ||
        e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowLeft')
    ) {
      e.preventDefault();
      const btns = getGameModalOptionBtns().filter((b) => !b.disabled);
      if (btns.length === 0) {
        return;
      }
      const focused = document.activeElement;
      const cur = btns.indexOf(focused);
      const delta = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
      const next = (cur + delta + btns.length) % btns.length;
      btns[next].focus();
    }
    return;
  }

  // Board keyboard navigation (when it's my turn, no modal)
  const gameState = getGameState();
  const myPlayerIndex = getMyPlayerIndex();

  if (!gameState || myPlayerIndex === null) {
    return;
  }
  if (gameState.currentPlayerIdx !== myPlayerIndex) {
    return;
  }
  const phase = getLocalPhase() ?? gameState.phase;
  if (phase !== PHASE.SELECT_PEG && phase !== PHASE.SELECT_TILE) {
    return;
  }

  if (e.key in NAV_DIRS) {
    e.preventDefault();
    const [dr, dc] = NAV_DIRS[e.key];
    const cursor = getNavCursor();
    const newRow = Math.max(0, Math.min(gameState.boardSize - 1, cursor.row + dr));
    const newCol = Math.max(0, Math.min(gameState.boardSize - 1, cursor.col + dc));
    setNavCursor({ row: newRow, col: newCol });
    // Trigger re-render (handled by caller)
    return;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    // Will be handled by onTileClick/onPegClick in game.js
  }
}

export { KEY_MAP, NAV_DIRS };
