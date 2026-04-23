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

export const CAT_NAMES = {
  arts: 'Arts',
  music: 'Music',
  death_metal: 'Death Metal',
  entertainment: 'Entertainment',
  literature: 'Literature',
  science: 'Science',
  nature: 'Nature',
  history: 'History',
  geography: 'Geography',
  sports: 'Sports',
  epl_2025: 'EPL 2025',
  other: 'Other',
};

export const CAT_COLORS = {
  arts: '#C62828',
  geography: '#00695C',
  history: '#6D4C41',
  literature: '#1565C0',
  science: '#969517',
  nature: '#388E3C',
  music: '#6A1B9A',
  death_metal: '#37474F',
  entertainment: '#E65100',
  sports: '#bd1b8a',
  epl_2025: '#38003C',
  other: '#546E7A',
};

export const CATS = Object.keys(CAT_NAMES);

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