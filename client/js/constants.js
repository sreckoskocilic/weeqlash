export const PHASE = {
  SELECT_PEG: 'selectPeg',
  SELECT_TILE: 'selectTile',
  GAME_OVER: 'gameOver',
};

export const COORD_BASE = 100;

export const OPTION_KEYS = ['A', 'B', 'C', 'D'];

// Mirror of server/game/engine.ts CATEGORIES — keep in sync by hand.
const CATEGORIES = {
  arts: { label: 'Arts', color: '#C62828' },
  music: { label: 'Music', color: '#6A1B9A' },
  death_metal: { label: 'Death Metal', color: '#37474F', defaultOff: true },
  entertainment: { label: 'Entertainment', color: '#E65100' },
  literature: { label: 'Literature', color: '#1565C0' },
  science: { label: 'Science', color: '#969517' },
  nature: { label: 'Nature', color: '#388E3C' },
  history: { label: 'History', color: '#6D4C41' },
  geography: { label: 'Geography', color: '#00695C' },
  sports: { label: 'Sports', color: '#bd1b8a' },
  other: { label: 'Other', color: '#546E7A', defaultOff: true },
};
export const CATS = Object.keys(CATEGORIES);
export const CAT_NAMES = Object.fromEntries(
  Object.entries(CATEGORIES).map(([id, c]) => [id, c.label]),
);
export const CAT_COLORS = Object.fromEntries(
  Object.entries(CATEGORIES).map(([id, c]) => [id, c.color]),
);
export const DEFAULT_CATS = Object.entries(CATEGORIES)
  .filter(([, c]) => !c.defaultOff)
  .map(([id]) => id);

export const QLAS_DEFAULT_HP = 15;
export const QLAS_HP_OPTIONS = [10, 15, 20, 30];

const _localHost = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
export const TEST_SPEED = _localHost
  ? Number(new URLSearchParams(window.location.search).get('testSpeed')) || 1
  : 1;
export const TIMING = {
  RESULT_DISPLAY_MS: 1500 / TEST_SPEED,
  NEXT_QUESTION_DELAY_MS: 1600 / TEST_SPEED,
  WRONG_ANSWER_DELAY_MS: 500 / TEST_SPEED,
  TICK_INTERVAL_MS: 100,
  TIMER_WARNING_PCT: 50,
  TIMER_DANGER_PCT: 25,
  ANSWER_DELAY_MS: 2000 / TEST_SPEED,
};
