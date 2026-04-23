// Pure game logic — no DOM, no globals, all functions take state as first arg.

/**
 * PHASE enum - Server-side game phases
 *
 * Note: This is a simplified version compared to the original game (srazique).
 * Original has: SELECT_PEG, SELECT_TILE, QUESTION, COMBAT_Q1, COMBAT_Q2, FLAG_Q, GAME_OVER
 *
 * We only need SELECT_PEG, SELECT_TILE, GAME_OVER on the server because:
 * - QUESTION, COMBAT_Q1, COMBAT_Q2, FLAG_Q are client-side UI phases for displaying modals
 * - Server just handles the final answer validation via applyTurn()
 * - This keeps server logic cleaner and delegates UI state to client
 */
export const PHASE = {
  SELECT_PEG: 'selectPeg',
  SELECT_TILE: 'selectTile',
  GAME_OVER: 'gameOver',
} as const;

export type Phase = (typeof PHASE)[keyof typeof PHASE];

export const CATS = [
  'arts',
  'music',
  'death_metal',
  'entertainment',
  'literature',
  'science',
  'nature',
  'history',
  'geography',
  'sports',
  'epl_2025',
  'other',
] as const;

export type Category = (typeof CATS)[number];

export const COORD_BASE = 100;
const DIRS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Peg {
  id: string;
  playerId: number;
  row: number;
  col: number;
  hp: number;
}

interface Tile {
  category: Category | 'flag';
  pegId: string | null;
  cornerOwner: number | null;
}

interface Player {
  id: number; // player index (0, 1, 2...) — not UUID
  name: string;
  color: string;
  userId: string | null;
  pegIds: string[];
  stats: {
    byCategory: Record<string, { attempts: number; correct: number }>;
    gamesPlayed: number;
    gamesWon: number;
  };
}

interface PendingTurn {
  pegId: string;
  targetR: number;
  targetC: number;
  moveType: 'normal' | 'combat' | 'flag';
  questionId: string;
  questionsRemaining: number;
  questionsTotal: number;
}

export interface GameState {
  boardSize: number;
  board: Tile[][];
  pegs: Record<string, Peg>;
  players: Player[];
  numPlayers: number;
  currentPlayerIdx: number;
  phase: Phase;
  selectedPegId: string | null;
  pendingTurn: PendingTurn | null;
  movesRemaining: number;
  winner: number | null;
  enabledCats: readonly Category[];
  usedQ: Record<Category, Set<string>>;
  wrongQ: Set<string>;
}

// Questions DB shape (as used by questions.js)
export interface Question {
  id: string;
  a: number; // correct answer index
  category: Category;
  points: number;
  penalty: number;
  // other fields like question, options, etc. are ignored by engine
}

export type QuestionsDbCategories = {
  [category in Category]: Question[];
};
export type QuestionsDb = QuestionsDbCategories & {
  _byId?: Record<string, Question>;
};

// Submission from client
export interface Submission {
  pegId: string;
  targetR: number;
  targetC: number;
  answerIdx: number;
}

// Turn result from applyTurn
export interface TurnResult {
  ok: true;
  events: GameEvent[];
  gameOver: boolean;
  winner: number | null;
  correct: boolean;
  combatContinues: boolean;
}

export type GameResult = TurnResult | { error: string };

// Game events
interface GameEvent {
  type: string;
  [key: string]: any;
}

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------

function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomCat(enabledCats: readonly Category[], seed: number | null = null): Category {
  const cats = enabledCats.length ? enabledCats : CATS;
  let idx;
  if (seed !== null) {
    // Deterministic for tests
    idx = seed % cats.length;
  } else {
    idx = Math.floor(Math.random() * cats.length);
  }
  return cats[idx];
}

// ---------------------------------------------------------------------------
// Board helpers
// ---------------------------------------------------------------------------

function adjTiles(state: GameState, r: number, c: number): { r: number; c: number }[] {
  return DIRS.map(([dr, dc]) => ({ r: r + dr, c: c + dc })).filter(
    (p) => p.r >= 0 && p.r < state.boardSize && p.c >= 0 && p.c < state.boardSize,
  );
}

export function getValidMoves(state: GameState, pegId: string): { r: number; c: number }[] {
  const peg = state.pegs[pegId];
  if (!peg) {
    return [];
  }
  return adjTiles(state, peg.row, peg.col).filter(({ r, c }) => {
    const tile = state.board[r][c];
    // Can't move back onto own flag corner
    if (tile.category === 'flag' && tile.cornerOwner === peg.playerId) {
      return false;
    }
    const occ = tile.pegId;
    // Can move to empty tile or tile occupied by enemy
    return !occ || state.pegs[occ].playerId !== peg.playerId;
  });
}

function generateLayoutMap(
  boardSize: number,
  enabledCats: readonly Category[],
  seed: number | null = null,
): (number | 'F')[][] {
  const isCorner = (r: number, c: number) =>
    (r === 0 || r === boardSize - 1) && (c === 0 || c === boardSize - 1);
  const useFlagCorners = boardSize > 4;
  const map: (number | 'F')[][] = Array.from({ length: boardSize }, () =>
    Array(boardSize).fill(null),
  );

  const nonCornerTiles: [number, number][] = [];
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      if (isCorner(r, c) && useFlagCorners) {
        map[r][c] = 'F';
      } else {
        nonCornerTiles.push([r, c]);
      }
    }
  }

  // Ensure each enabled category appears at least once
  const cats = [...enabledCats];
  const shuffledCats = shuffle(cats);
  // Fill first N tiles with unique categories (using indices)
  for (let i = 0; i < Math.min(nonCornerTiles.length, enabledCats.length); i++) {
    const [r, c] = nonCornerTiles[i];
    const catName = shuffledCats[i];
    map[r][c] = enabledCats.indexOf(catName);
  }
  // Fill remaining tiles with random categories (deterministic in tests)
  for (let i = enabledCats.length; i < nonCornerTiles.length; i++) {
    const [r, c] = nonCornerTiles[i];
    const catName = randomCat(enabledCats, seed !== null ? seed + i : null);
    map[r][c] = enabledCats.indexOf(catName);
  }

  return map;
}

function getCornerOwnerMap(numPlayers: number, boardSize: number): Record<string, number> {
  if (boardSize === 4 || boardSize === 2) {
    return {};
  }
  const S = boardSize - 1;
  const map: Record<string, number> = { '0,0': 0 };
  if (numPlayers === 2) {
    map[`${S},${S}`] = 1;
  } else if (numPlayers === 3) {
    map[`0,${S}`] = 1;
    map[`${S},${S}`] = 2;
  } else {
    map[`0,${S}`] = 1;
    map[`${S},0`] = 2;
    map[`${S},${S}`] = 3;
  }
  return map;
}

function getStartPositions(
  numPlayers: number,
  boardSize: number,
): Array<Array<{ r: number; c: number }>> {
  const S = boardSize - 1;
  if (boardSize === 2) {
    // For 2x2 board, only 1 peg per player
    const corners = [[{ r: 0, c: 0 }], [{ r: 0, c: S }], [{ r: S, c: 0 }], [{ r: S, c: S }]];
    if (numPlayers === 2) {
      return [corners[0], corners[3]];
    }
    if (numPlayers === 3) {
      return [corners[0], corners[1], corners[3]];
    }
    return corners;
  }
  if (boardSize === 4) {
    const corners = [[{ r: 0, c: 0 }], [{ r: 0, c: S }], [{ r: S, c: 0 }], [{ r: S, c: S }]];
    if (numPlayers === 2) {
      return [corners[0], corners[3]];
    }
    if (numPlayers === 3) {
      return [corners[0], corners[1], corners[3]];
    }
    return corners;
  }
  const all = [
    [
      { r: 1, c: 0 },
      { r: 0, c: 1 },
      { r: 1, c: 1 },
    ],
    [
      { r: 1, c: S },
      { r: 0, c: S - 1 },
      { r: 1, c: S - 1 },
    ],
    [
      { r: S - 1, c: 0 },
      { r: S, c: 1 },
      { r: S - 1, c: 1 },
    ],
    [
      { r: S - 1, c: S },
      { r: S, c: S - 1 },
      { r: S - 1, c: S - 1 },
    ],
  ];
  if (numPlayers === 2) {
    return [all[0], all[3]];
  }
  if (numPlayers === 3) {
    return [all[0], all[1], all[3]];
  }
  return all;
}

// ---------------------------------------------------------------------------
// Peg mutations
// ---------------------------------------------------------------------------

function movePeg(state: GameState, pegId: string, r: number, c: number): void {
  const peg = state.pegs[pegId];
  state.board[peg.row][peg.col].pegId = null;
  peg.row = r;
  peg.col = c;
  state.board[r][c].pegId = pegId;
}

function eliminatePeg(state: GameState, pegId: string): void {
  const peg = state.pegs[pegId];
  state.board[peg.row][peg.col].pegId = null;
  state.players[peg.playerId].pegIds = state.players[peg.playerId].pegIds.filter(
    (id) => id !== pegId,
  );
}

// ---------------------------------------------------------------------------
// Win condition
// ---------------------------------------------------------------------------

export function checkWinCondition(state: GameState): number {
  let survivor = -1,
    living = 0;
  for (const p of state.players) {
    if (p.pegIds.length > 0) {
      survivor = p.id; // Note: p.id is the player index (integer), not a UUID
      living++;
    }
  }
  return living === 1 ? survivor : -1;
}

// ---------------------------------------------------------------------------
// Turn helpers (match desktop game mechanics)
// ---------------------------------------------------------------------------

function handleCorrectAnswer(
  state: GameState,
  pegId: string,
  targetR: number,
  targetC: number,
  events: GameEvent[],
): void {
  movePeg(state, pegId, targetR, targetC);
  events.push({ type: 'peg_moved', pegId, r: targetR, c: targetC });
}

function handleIncorrectAnswer(state: GameState, questionId: string): void {
  state.wrongQ.add(questionId);
}

function updatePlayerStats(
  state: GameState,
  playerId: number,
  questionId: string,
  correct: boolean,
  questionsDb: QuestionsDb,
): void {
  const cp = state.players[playerId];
  if (cp?.stats) {
    const question = questionsDb._byId?.[questionId];
    const cat = question?.category || 'unknown';
    if (!cp.stats.byCategory) {
      cp.stats.byCategory = {};
    }
    if (!cp.stats.byCategory[cat]) {
      cp.stats.byCategory[cat] = { attempts: 0, correct: 0 };
    }
    cp.stats.byCategory[cat].attempts++;
    if (correct) {
      cp.stats.byCategory[cat].correct++;
    }
  }
}

function checkAndHandleGameOver(
  state: GameState,
  winnerIdx: number,
  events: GameEvent[],
): TurnResult {
  state.players.forEach((p, i) => {
    p.stats.gamesPlayed++;
    if (i === winnerIdx) {
      p.stats.gamesWon++;
    }
  });
  state.phase = PHASE.GAME_OVER;
  state.winner = winnerIdx;
  return {
    ok: true,
    events,
    gameOver: true,
    winner: winnerIdx,
    correct: false,
    combatContinues: false,
  };
}

// ---------------------------------------------------------------------------
// Question selection
// ---------------------------------------------------------------------------

// Pick `count` question IDs from `cat`, tracking used ones per state.
function ensureQuestionTrackingSet(state: GameState, key: Category | '__all__'): Set<string> {
  if (!state.usedQ[key as Category]) {
    state.usedQ[key as Category] = new Set();
  }
  return state.usedQ[key as Category];
}

function getAllQuestionPool(questionsDb: QuestionsDb): Question[] {
  return Object.values(questionsDb)
    .filter(Array.isArray)
    .flat()
    .filter((q): q is Question => !!q?.id);
}

function takeQuestions(
  pool: Question[],
  usedSet: Set<string>,
  wrongSet: Set<string>,
  count: number,
  excludedIds: Set<string> = new Set(),
): Question[] {
  if (!pool?.length || count <= 0) {
    return [];
  }

  const selected: Question[] = [];
  const reservedIds = new Set(excludedIds);

  // Pre-compute eligibility once to avoid multiple filtering passes
  const eligible = pool.filter(
    (q) => !usedSet.has(q.id) && !wrongSet.has(q.id) && !reservedIds.has(q.id),
  );

  if (eligible.length >= count) {
    // We have enough eligible questions, shuffle and take what we need
    const shuffled = shuffle(eligible);
    selected.push(...shuffled.slice(0, count));
    selected.forEach((q) => usedSet.add(q.id));
    return selected;
  }

  // Not enough eligible questions, take all eligible ones
  selected.push(...eligible);
  eligible.forEach((q) => usedSet.add(q.id));

  // If we still need more, clear usedSet and try again (but avoid duplicates)
  if (selected.length < count) {
    usedSet.clear();

    // Get all questions excluding wrong ones and already selected ones in this batch
    const remainingPool = pool.filter(
      (q) =>
        !wrongSet.has(q.id) && !reservedIds.has(q.id) && !selected.some((sq) => sq.id === q.id),
    );

    if (remainingPool.length > 0) {
      const needed = count - selected.length;
      const shuffled = shuffle(remainingPool);
      selected.push(...shuffled.slice(0, Math.min(needed, remainingPool.length)));
      selected.forEach((q) => usedSet.add(q.id));
    }

    // If we STILL don't have enough, allow repeats but avoid immediate duplicates
    if (selected.length < count) {
      const needed = count - selected.length;
      const poolForRepeats = pool.filter((q) => !wrongSet.has(q.id) && !reservedIds.has(q.id));

      if (poolForRepeats.length > 0) {
        // Shallow shuffle for variety but allow repeats
        const shuffledPool = shuffle(poolForRepeats);
        for (let i = 0; i < needed; i++) {
          selected.push(shuffledPool[i % shuffledPool.length]);
          usedSet.add(shuffledPool[i % shuffledPool.length].id);
        }
      }
    }
  }

  return selected;
}

function pickQuestionIds(
  state: GameState,
  cat: Category,
  count: number,
  questionsDb: QuestionsDb,
  excludedIds: Set<string> = new Set(),
): string[] {
  const wrongSet = state.wrongQ;
  const primaryPool = (questionsDb as QuestionsDbCategories)[cat];
  const primaryUsedSet = ensureQuestionTrackingSet(state, cat);

  const selected = takeQuestions(primaryPool, primaryUsedSet, wrongSet, count, excludedIds);

  if (selected.length >= count) {
    return selected.map((q) => q.id);
  }

  const fallbackPool = getAllQuestionPool(questionsDb);
  const fallbackUsedSet = ensureQuestionTrackingSet(state, '__all__');
  const fallbackSelected = takeQuestions(
    fallbackPool,
    fallbackUsedSet,
    wrongSet,
    count - selected.length,
    new Set([...excludedIds, ...selected.map((q) => q.id)]),
  );

  return [...selected, ...fallbackSelected].map((q) => q.id);
}

// Determine move type from board state.
// Priority matches: combat (enemy peg) is checked BEFORE flag capture.
function getMoveType(
  state: GameState,
  pegId: string,
  r: number,
  c: number,
): 'normal' | 'combat' | 'flag' {
  const tile = state.board[r][c];
  if (tile.pegId && state.pegs[tile.pegId].playerId !== state.pegs[pegId].playerId) {
    return 'combat';
  }
  if (
    tile.category === 'flag' &&
    tile.cornerOwner !== null &&
    tile.cornerOwner !== state.pegs[pegId].playerId
  ) {
    return 'flag';
  }
  return 'normal';
}

// ---------------------------------------------------------------------------
// Public: plan questions for a pending move
// Called when player selects a tile. Returns { moveType, questionIds }
// and records the pending turn on state for later validation.
// ---------------------------------------------------------------------------

export function planTurnQuestions(
  state: GameState,
  pegId: string,
  targetR: number,
  targetC: number,
  questionsDb: QuestionsDb,
): { moveType: 'normal' | 'combat' | 'flag'; questionId: string } {
  const tile = state.board[targetR][targetC];
  const moveType = getMoveType(state, pegId, targetR, targetC);
  const tileCat = tile.category === 'flag' ? 'other' : tile.category;

  let firstQuestionId: string;
  let questionsTotal: number = 1;

  if (moveType === 'flag') {
    questionsTotal = 3;
    [firstQuestionId] = pickQuestionIds(state, randomCat(state.enabledCats), 1, questionsDb);
  } else if (moveType === 'combat') {
    questionsTotal = Math.min(state.movesRemaining, 3);
    [firstQuestionId] = pickQuestionIds(state, tileCat, 1, questionsDb);
  } else {
    [firstQuestionId] = pickQuestionIds(state, tileCat, 1, questionsDb);
  }

  state.pendingTurn = {
    pegId,
    targetR,
    targetC,
    moveType,
    questionId: firstQuestionId,
    questionsRemaining: questionsTotal,
    questionsTotal,
  };

  return { moveType, questionId: firstQuestionId };
}

// Pick the next question for an ongoing combat or flag sequence.
// Updates state.pendingTurn.questionId and decrements questionsRemaining.
// Returns the new question id, or null if no more questions.
export function advancePendingQuestion(state: GameState, questionsDb: QuestionsDb): string | null {
  const pending = state.pendingTurn;
  if (!pending || pending.questionsRemaining <= 1) {
    return null;
  }
  pending.questionsRemaining--;
  const cat = randomCat(state.enabledCats);
  const [nextId] = pickQuestionIds(state, cat, 1, questionsDb);
  pending.questionId = nextId;
  return nextId;
}

// ---------------------------------------------------------------------------
// Public: validate peg selection
// ---------------------------------------------------------------------------

export function selectPeg(
  state: GameState,
  playerId: number,
  pegId: string,
): { ok: true; validMoves: number[] } | { error: string } {
  if (state.phase !== PHASE.SELECT_PEG && state.phase !== PHASE.SELECT_TILE) {
    return { error: 'Wrong phase' };
  }
  const currentPlayer = state.players[state.currentPlayerIdx];
  if (currentPlayer.id !== playerId) {
    return { error: 'Not your turn' };
  }
  if (!currentPlayer.pegIds.includes(pegId)) {
    return { error: 'Not your peg' };
  }
  const moves = getValidMoves(state, pegId);
  if (moves.length === 0) {
    return { error: 'No valid moves' };
  }

  state.pendingTurn = null;
  state.selectedPegId = pegId;
  state.phase = PHASE.SELECT_TILE;

  return {
    ok: true,
    validMoves: moves.map(({ r, c }) => r * COORD_BASE + c),
  };
}

// ---------------------------------------------------------------------------
// Public: apply full submitted turn
// submission: { pegId, targetR, targetC, answerIdx }
// Returns { ok, events, gameOver, winner, correct, combatContinues } or { error }
// ---------------------------------------------------------------------------

export function applyTurn(
  state: GameState,
  playerId: number,
  submission: Submission,
  questionsDb: QuestionsDb,
): GameResult {
  const pending = state.pendingTurn;
  if (!pending) {
    return { error: 'No pending turn' };
  }

  const currentPlayer = state.players[state.currentPlayerIdx];
  if (currentPlayer.id !== playerId) {
    return { error: 'Not your turn' };
  }
  if (submission.pegId !== pending.pegId) {
    return { error: 'Peg mismatch' };
  }
  if (submission.targetR !== pending.targetR || submission.targetC !== pending.targetC) {
    return { error: 'Target mismatch' };
  }

  const { pegId, targetR, targetC, moveType, questionId } = pending;
  const q = questionsDb._byId?.[questionId];
  const noAnswer = submission.answerIdx === -1;
  const correct = noAnswer ? false : q ? q.a === submission.answerIdx : false;
  const events: GameEvent[] = [];

  events.push({ type: 'answer', questionId, correct });
  if (!noAnswer) {
    // Only update stats if player actually gave an answer (not timeout)
    handleIncorrectAnswer(state, questionId);
    updatePlayerStats(state, state.currentPlayerIdx, questionId, correct, questionsDb);
  }

  if (moveType === 'normal') {
    if (correct) {
      handleCorrectAnswer(state, pegId, targetR, targetC, events);
    }
    state.pendingTurn = null;
    state.movesRemaining--;
    if (state.movesRemaining === 0) {
      advanceTurn(state);
    } else if (correct && getValidMoves(state, pegId).length > 0) {
      state.phase = PHASE.SELECT_TILE;
      return { ok: true, events, gameOver: false, correct, combatContinues: false, winner: null };
    } else {
      state.selectedPegId = null;
      state.phase = PHASE.SELECT_PEG;
      return { ok: true, events, gameOver: false, correct, combatContinues: false, winner: null };
    }
    return { ok: true, events, gameOver: false, correct, combatContinues: false, winner: null };
  } else if (moveType === 'combat') {
    const defPegId = state.board[targetR]?.[targetC]?.pegId;
    const defPeg = defPegId ? state.pegs[defPegId] : null;

    if (correct && defPeg) {
      defPeg.hp--;
      events.push({ type: 'combat_hit', defPegId, hp: defPeg.hp });
    }

    const defEliminated = defPeg !== null && defPeg.hp === 0;
    if (defEliminated) {
      eliminatePeg(state, defPegId as string);
      events.push({ type: 'peg_eliminated', pegId: defPegId as string });
      handleCorrectAnswer(state, pegId, targetR, targetC, events);
    }

    const combatContinues = correct && !defEliminated && pending.questionsRemaining > 1;

    if (!combatContinues) {
      state.pendingTurn = null;
      state.movesRemaining = 0;
      const winner = checkWinCondition(state);
      if (winner >= 0) {
        return checkAndHandleGameOver(state, winner, events);
      }
      advanceTurn(state);
    }
    return { ok: true, events, gameOver: false, correct, combatContinues, winner: null };
  } else if (moveType === 'flag') {
    const allCorrect = correct && pending.questionsRemaining === 1;
    if (!correct || pending.questionsRemaining === 1) {
      state.pendingTurn = null;
      if (allCorrect) {
        const winnerIdx = state.currentPlayerIdx;
        handleCorrectAnswer(state, pegId, targetR, targetC, events);
        events.push({ type: 'flag_captured', pegId, winnerIdx });
        return checkAndHandleGameOver(state, winnerIdx, events);
      }
      advanceTurn(state);
      return { ok: true, events, gameOver: false, correct, combatContinues: false, winner: null };
    }
    return { ok: true, events, gameOver: false, correct, combatContinues: true, winner: null };
  }

  return { ok: true, events, gameOver: false, correct, combatContinues: false, winner: null };
}

// ---------------------------------------------------------------------------
// Turn management
// ---------------------------------------------------------------------------

/**
 * Generate answer submissions for a bot.
 * Always selects answer index 0 (the first answer) for each question.
 * Used by the bot opponent in tests.
 *
 * @param {GameState} state - Current game state
 * @param {QuestionsDb} questionsDb - Database containing question definitions.
 * @returns {{answerIdx: number}} Answer submission.
 */
export function botAnswer(state: GameState, questionsDb: QuestionsDb): { answerIdx: number } {
  const qId = state.pendingTurn?.questionId;
  if (!qId) {
    return { answerIdx: 0 };
  }
  const q = questionsDb._byId?.[qId];
  return { answerIdx: q?.a ?? 0 };
}

/**
 * Reset per-turn flags and rebuild the set of pegs that can move this turn.
 * Called when a turn ends (whether by completion, elimination, or flag capture).
 *
 * Note: Question tracking (usedQ, wrongQ) persists across the entire game session
 * to prevent repeats even across turns. This is handled server-side only.
 */
function resetTurnState(state: GameState): void {
  state.pendingTurn = null;
  state.selectedPegId = null;
  state.movesRemaining = 3;
  state.phase = PHASE.SELECT_PEG;
}

function advanceTurn(state: GameState): void {
  let next = (state.currentPlayerIdx + 1) % state.numPlayers;
  let tries = 0;
  while (state.players[next].pegIds.length === 0 && tries < state.numPlayers) {
    next = (next + 1) % state.numPlayers;
    tries++;
  }
  state.currentPlayerIdx = next;
  // Reset all per-turn state for the new player
  resetTurnState(state);
}

// ---------------------------------------------------------------------------
// Public: create initial game state
// ---------------------------------------------------------------------------

export function createGame(
  players: Array<{ name: string; color: string; userId: string | null }>,
  settings: {
    boardSize?: number;
    enabledCats?: Category[];
    boardLayout?: (number | 'F')[][];
  } = {},
): GameState {
  const { boardSize = 7, enabledCats, boardLayout } = settings;
  const activeCats = enabledCats?.length ? enabledCats : CATS;
  const numPlayers = players.length;
  const layoutMap = boardLayout || generateLayoutMap(boardSize, activeCats);
  const cornerMap = getCornerOwnerMap(numPlayers, boardSize);

  const board: Tile[][] = Array.from({ length: boardSize }, (_outer, rowIdx) =>
    Array.from({ length: boardSize }, (_inner, colIdx) => {
      const val = layoutMap[rowIdx][colIdx];
      return {
        category: val === 'F' ? 'flag' : activeCats[val],
        pegId: null,
        cornerOwner: val === 'F' ? cornerMap[`${rowIdx},${colIdx}`] : null,
      };
    }),
  );

  const pegs: Record<string, Peg> = {};
  let pegIdx = 0;
  const startPositions = getStartPositions(numPlayers, boardSize);

  const gamePlayers: Player[] = players.map((p, i) => {
    const pegIds: string[] = [];
    for (const pos of startPositions[i]) {
      const id = `p${i}_${pegIdx++}`;
      pegs[id] = {
        id,
        playerId: i,
        row: pos.r,
        col: pos.c,
        hp: 3,
      };
      board[pos.r][pos.c].pegId = id;
      pegIds.push(id);
    }
    return {
      id: i,
      name: p.name,
      color: p.color,
      userId: p.userId ?? null,
      pegIds,
      stats: { byCategory: {}, gamesPlayed: 0, gamesWon: 0 },
    };
  });

  const state: GameState = {
    boardSize,
    board,
    pegs,
    players: gamePlayers,
    numPlayers,
    currentPlayerIdx: 0,
    phase: PHASE.SELECT_PEG,
    selectedPegId: null,
    pendingTurn: null,
    movesRemaining: 3,
    winner: null,
    enabledCats: activeCats,
    usedQ: Object.fromEntries(CATS.map((c) => [c, new Set()])) as Record<Category, Set<string>>,
    wrongQ: new Set(),
  };
  return state;
}
