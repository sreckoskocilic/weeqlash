// Single mutable namespace; import and mutate properties directly (e.g. `state.myId = id`).

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
  // Bumped per combat sequence to invalidate stale setTimeout callbacks.
  spectateGen: 0,
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
  setupBoardSize: 4,
  setupTimer: 30,
  setupEnabledCats: [],

  // Current user (from auth)
  currentUser: null,

  // HowHigh
};
