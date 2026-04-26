// ============================================================
// CONSTANTS
// ============================================================

export const PHASE = {
  SELECT_PEG: 'selectPeg',
  SELECT_TILE: 'selectTile',
  GAME_OVER: 'gameOver',
};

export const COORD_BASE = 100;

export const OPTION_KEYS = ['A', 'B', 'C', 'D'];

export const KEY_MAP = { a: 0, b: 1, c: 2, d: 3, 1: 0, 2: 1, 3: 2, 4: 3 };

// CATEGORIES come from the server (single source of truth — server/game/engine.ts).
// The express server generates `/js/categories.js` at startup from that config,
// so a category change in engine.ts shows up here on next reload — no drift.
export { CATEGORIES, CATS, CAT_NAMES, CAT_COLORS, DEFAULT_CATS } from './categories.js';

// Timing constants
export const TIMING = {
  RESULT_DISPLAY_MS: 1500,
  NEXT_QUESTION_DELAY_MS: 1600,
  WRONG_ANSWER_DELAY_MS: 500,
  TICK_INTERVAL_MS: 100,
  TIMER_WARNING_PCT: 50,
  TIMER_DANGER_PCT: 25,
  ANSWER_DELAY_MS: 2000,
};
