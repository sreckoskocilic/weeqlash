// ============================================================
// STATE
// ============================================================

// Player state
export let myId = null;
export let myToken = null;
export let myRoom = null;
export let isHost = false;
export let myPlayerIndex = null;

// Game state (from server)
let _gameState = null;
export let timerDuration = 30;

export function getGameState() {
  return _gameState;
}

export function setGameState(state) {
  _gameState = state;
}
export let tileEls = []; // [r][c]
export const movedPegs = new Set();

// Turn interaction
export let localPhase = null;
export let localSelectedPegId = null;
export let validMovesSet = new Set();

// Question
export let pendingMove = null;
export let pendingQuestions = [];
export let pendingQuestionsTotal = 1;
export let pendingAnswers = [];
export let currentQIdx = 0;
export let spectateGen = 0; // Incremented on each new combat sequence to invalidate stale setTimeout callbacks
export let timerInterval = null;
export let quizModalOptionBtns = [];
export let gameModalOptionBtns = [];
export let spectatingQuestion = false;
export let spectatingMoveType = null;
export let spectatingPlayerIdx = null;
export let spectatingDefenderIdx = null;
export let pendingCombatDefenderIdx = null;

// Navigation
export let navCursor = { row: 0, col: 0 };
export let lastSubmittedPegId = null;
export let lastSubmittedMoveType = null;

// Setup screen state
export const setupPlayerCount = 2;
export let setupBoardSize = 8;
export let setupTimer = 30;
export let setupEnabledCats = [];

// Current user (from auth)
export let _currentUser = null;
export function setCurrentUser(user) {
  _currentUser = user;
}

// Export getters for other modules
export function getMyPlayerIndex() { return myPlayerIndex; }
export function getLocalPhase() { return localPhase; }
export function getNavCursor() { return navCursor; }
export function setNavCursor(cursor) { navCursor = cursor; }
export function getSpectatingQuestion() { return spectatingQuestion; }
export function setLocalPhase(phase) { localPhase = phase; }
export function setLocalSelectedPegId(id) { localSelectedPegId = id; }
export function setValidMovesSet(set) { validMovesSet = set; }
export function setLastSubmittedPegId(id) { lastSubmittedPegId = id; }
export function setLastSubmittedMoveType(type) { lastSubmittedMoveType = type; }
export function setPendingAnswers(arr) { pendingAnswers = arr; }
export function setCurrentQIdx(idx) { currentQIdx = idx; }
export function setPendingQuestions(arr) { pendingQuestions = arr; }
export function setSpectatingQuestion(val) { spectatingQuestion = val; }
export function setPendingMove(move) { pendingMove = move; }

// Qlashique state (needed for socket reconnect)
export let qlasToken = null;
export let qlasCode = null;