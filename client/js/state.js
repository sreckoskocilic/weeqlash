// ============================================================
// STATE
// ============================================================
// Single mutable namespace. Import as `import { state } from './state.js'`
// and mutate properties directly (e.g. `state.myId = id`).

export const state = {
  // Identity / room
  myId: null,
  myToken: null,
  myRoom: null,
  isHost: false,
  myPlayerIndex: null,

  // Game state from server
  gameState: null,
  timerDuration: 30,

  // Board rendering cache
  tileEls: [],
  movedPegs: new Set(),

  // Turn interaction
  localPhase: null,
  localSelectedPegId: null,
  validMovesSet: new Set(),

  // Question modal
  pendingMove: null,
  pendingQuestions: [],
  pendingQuestionsTotal: 1,
  pendingAnswers: [],
  currentQIdx: 0,
  // spectateGen is incremented on each new combat sequence to invalidate
  // stale setTimeout callbacks.
  spectateGen: 0,
  timerInterval: null,
  quizModalOptionBtns: [],
  gameModalOptionBtns: [],
  spectatingQuestion: false,
  spectatingMoveType: null,
  spectatingPlayerIdx: null,
  spectatingDefenderIdx: null,
  pendingCombatDefenderIdx: null,

  // Navigation
  navCursor: { row: 0, col: 0 },
  lastSubmittedPegId: null,
  lastSubmittedMoveType: null,

  // Setup screen
  setupPlayerCount: 2,
  setupBoardSize: 8,
  setupTimer: 30,
  setupEnabledCats: [],

  // Current user (from auth)
  currentUser: null,

  // Qlashique state (socket reconnect)
  qlasToken: null,
  qlasCode: null,
};
