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
};

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
  'other',
];

export const COORD_BASE = 100;
const DIRS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomCat(enabledCats, seed = null) {
  const cats = enabledCats?.length ? enabledCats : CATS;
  let idx;
  if (seed !== null) {
    // Deterministic for tests
    idx = seed % cats.length;
  } else {
    idx = Math.floor(Math.random() * cats.length);
  }
  return idx; // Return index, not name
}

// ---------------------------------------------------------------------------
// Board helpers
// ---------------------------------------------------------------------------

function adjTiles(state, r, c) {
  return DIRS.map(([dr, dc]) => ({ r: r + dr, c: c + dc })).filter(
    (p) =>
      p.r >= 0 && p.r < state.boardSize && p.c >= 0 && p.c < state.boardSize,
  );
}

export function getValidMoves(state, pegId) {
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

function generateLayoutMap(boardSize, enabledCats, seed = null) {
  const isCorner = (r, c) =>
    (r === 0 || r === boardSize - 1) && (c === 0 || c === boardSize - 1);
  const useFlagCorners = boardSize > 4;
  const map = Array.from({ length: boardSize }, () =>
    Array(boardSize).fill(null),
  );

  const nonCornerTiles = [];
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
    map[r][c] = randomCat(enabledCats, seed !== null ? seed + i : null);
  }

  return map;
}

function getCornerOwnerMap(numPlayers, boardSize) {
  if (boardSize === 4 || boardSize === 2) {
    return [];
  }
  const S = boardSize - 1;
  const map = { '0,0': 0 };
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

function getStartPositions(numPlayers, boardSize) {
  const S = boardSize - 1;
  if (boardSize === 2) {
    // For 2x2 board, only 1 peg per player
    const corners = [
      [{ r: 0, c: 0 }],
      [{ r: 0, c: S }],
      [{ r: S, c: 0 }],
      [{ r: S, c: S }],
    ];
    if (numPlayers === 2) {
      return [corners[0], corners[3]];
    }
    if (numPlayers === 3) {
      return [corners[0], corners[1], corners[3]];
    }
    return corners;
  }
  if (boardSize === 4) {
    const corners = [
      [{ r: 0, c: 0 }],
      [{ r: 0, c: S }],
      [{ r: S, c: 0 }],
      [{ r: S, c: S }],
    ];
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

function movePeg(state, pegId, r, c) {
  const peg = state.pegs[pegId];
  state.board[peg.row][peg.col].pegId = null;
  peg.row = r;
  peg.col = c;
  state.board[r][c].pegId = pegId;
}

function eliminatePeg(state, pegId) {
  const peg = state.pegs[pegId];
  state.board[peg.row][peg.col].pegId = null;
  state.players[peg.playerId].pegIds = state.players[
    peg.playerId
  ].pegIds.filter((id) => id !== pegId);
}


// ---------------------------------------------------------------------------
// Win condition
// ---------------------------------------------------------------------------

export function checkWinCondition(state) {
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

// ---------------------------------------------------------------------------
// Question selection
// ---------------------------------------------------------------------------

// Pick `count` question IDs from `cat`, tracking used ones per state.
function ensureQuestionTrackingSet(state, key) {
  if (!state.usedQ[key]) {
    state.usedQ[key] = new Set();
  }
  return state.usedQ[key];
}

function getAllQuestionPool(questionsDb) {
  return Object.values(questionsDb)
    .filter(Array.isArray)
    .flat()
    .filter((q) => q?.id);
}

function takeQuestions(pool, usedSet, wrongSet, count, excludedIds = new Set()) {
  if (!pool?.length || count <= 0) {
    return [];
  }

  const selected = [];
  const reservedIds = new Set(excludedIds);

  const phases = [
    () => pool.filter((q) => !usedSet.has(q.id) && !wrongSet.has(q.id) && !reservedIds.has(q.id)),
    () => {
      usedSet.clear();
      return pool.filter((q) => !wrongSet.has(q.id) && !reservedIds.has(q.id));
    },
    () => pool.filter((q) => !usedSet.has(q.id) && !reservedIds.has(q.id)),
    () => {
      usedSet.clear();
      return pool.filter((q) => !reservedIds.has(q.id));
    },
  ];

  for (const phase of phases) {
    if (selected.length >= count) {break;}
    const candidates = shuffle(phase());
    for (const q of candidates) {
      if (selected.length >= count) {break;}
      selected.push(q);
      reservedIds.add(q.id);
    }
  }

  if (selected.length < count) {
    const repeats = shuffle(pool);
    let idx = 0;
    while (selected.length < count && repeats.length > 0) {
      selected.push(repeats[idx % repeats.length]);
      idx++;
    }
  }

  selected.forEach((q) => usedSet.add(q.id));
  return selected;
}

function pickQuestionIds(state, cat, count, questionsDb, excludedIds = new Set()) {
  const wrongSet = state.wrongQ;
  const primaryPool = questionsDb[cat];
  const primaryUsedSet = ensureQuestionTrackingSet(state, cat);

  const selected = takeQuestions(
    primaryPool,
    primaryUsedSet,
    wrongSet,
    count,
    excludedIds,
  );

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
function getMoveType(state, pegId, r, c) {
  const tile = state.board[r][c];
  if (
    tile.pegId &&
    state.pegs[tile.pegId].playerId !== state.pegs[pegId].playerId
  ) {
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

export function planTurnQuestions(state, pegId, targetR, targetC, questionsDb) {
  const tile = state.board[targetR][targetC];
  const moveType = getMoveType(state, pegId, targetR, targetC);
  const tileCat = tile.category === 'flag' ? 'other' : tile.category;

  let firstQuestionId;
  let questionsTotal = 1;

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
export function advancePendingQuestion(state, questionsDb) {
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

export function selectPeg(state, playerId, pegId) {
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
// submission: { pegId, targetR, targetC, answers: [{questionId, answerIdx}] }
// Returns { ok, events, gameOver, winner, state } or { error }
// ---------------------------------------------------------------------------

// submission: { pegId, targetR, targetC, answerIdx }
// Returns { ok, events, gameOver, winner, correct, combatContinues } or { error }
export function applyTurn(state, playerId, submission, questionsDb) {
  const pending = state.pendingTurn;
  if (!pending) { return { error: 'No pending turn' }; }

  const currentPlayer = state.players[state.currentPlayerIdx];
  if (currentPlayer.id !== playerId) { return { error: 'Not your turn' }; }
  if (submission.pegId !== pending.pegId) { return { error: 'Peg mismatch' }; }
  if (submission.targetR !== pending.targetR || submission.targetC !== pending.targetC) {
    return { error: 'Target mismatch' };
  }

  const { pegId, targetR, targetC, moveType, questionId } = pending;
  const q = questionsDb._byId?.[questionId];
  const correct = q ? (q.a === submission.answerIdx) : false;
  const events = [];

  events.push({ type: 'answer', questionId, correct });
  if (!correct) { state.wrongQ.add(questionId); }
  const cp = state.players[state.currentPlayerIdx];
  if (cp?.stats) {
    const cat = q?.category || 'unknown';
    if (!cp.stats.byCategory) { cp.stats.byCategory = {}; }
    if (!cp.stats.byCategory[cat]) { cp.stats.byCategory[cat] = { attempts: 0, correct: 0 }; }
    cp.stats.byCategory[cat].attempts++;
    if (correct) { cp.stats.byCategory[cat].correct++; }
  }

  if (moveType === 'normal') {
    if (correct) {
      movePeg(state, pegId, targetR, targetC);
      events.push({ type: 'peg_moved', pegId, r: targetR, c: targetC });
    }
    state.pendingTurn = null;
    state.movesRemaining--;
    if (state.movesRemaining === 0) {
      advanceTurn(state);
    } else if (correct && getValidMoves(state, pegId).length > 0) {
      state.phase = PHASE.SELECT_TILE;
      return { ok: true, events, gameOver: false, correct, combatContinues: false };
    } else {
      state.selectedPegId = null;
      state.phase = PHASE.SELECT_PEG;
      return { ok: true, events, gameOver: false, correct, combatContinues: false };
    }
    return { ok: true, events, gameOver: false, correct, combatContinues: false };

  } else if (moveType === 'combat') {
    const defPegId = state.board[targetR]?.[targetC]?.pegId;
    const defPeg = defPegId ? state.pegs[defPegId] : null;

    if (correct && defPeg) {
      defPeg.hp--;
      events.push({ type: 'combat_hit', defPegId, hp: defPeg.hp });
    }

    const defEliminated = defPeg && defPeg.hp === 0;
    if (defEliminated) {
      eliminatePeg(state, defPegId);
      events.push({ type: 'peg_eliminated', pegId: defPegId });
      movePeg(state, pegId, targetR, targetC);
      events.push({ type: 'peg_moved', pegId, r: targetR, c: targetC });
    }

    const combatContinues = correct && !defEliminated && pending.questionsRemaining > 1;

    if (!combatContinues) {
      state.pendingTurn = null;
      state.movesRemaining = 0;
      const winner = checkWinCondition(state);
      if (winner >= 0) {
        state.players.forEach((p, i) => {
          p.stats.gamesPlayed++;
          if (i === winner) { p.stats.gamesWon++; }
        });
        state.phase = PHASE.GAME_OVER;
        state.winner = winner;
        return { ok: true, events, gameOver: true, winner, correct, combatContinues: false };
      }
      advanceTurn(state);
    }
    return { ok: true, events, gameOver: false, correct, combatContinues };

  } else if (moveType === 'flag') {
    const allCorrect = correct && pending.questionsRemaining === 1;
    if (!correct || pending.questionsRemaining === 1) {
      state.pendingTurn = null;
      if (allCorrect) {
        const winnerIdx = state.currentPlayerIdx;
        movePeg(state, pegId, targetR, targetC);
        events.push({ type: 'peg_moved', pegId, r: targetR, c: targetC });
        events.push({ type: 'flag_captured', pegId, winnerIdx });
        state.players.forEach((p, i) => {
          p.stats.gamesPlayed++;
          if (i === winnerIdx) { p.stats.gamesWon++; }
        });
        state.phase = PHASE.GAME_OVER;
        state.winner = winnerIdx;
        return { ok: true, events, gameOver: true, winner: winnerIdx, correct, combatContinues: false };
      }
      advanceTurn(state);
      return { ok: true, events, gameOver: false, correct, combatContinues: false };
    }
    return { ok: true, events, gameOver: false, correct, combatContinues: true };
  }

  return { ok: true, events, gameOver: false, correct, combatContinues: false };
}

// ---------------------------------------------------------------------------
// Turn management
// ---------------------------------------------------------------------------

/**
 * Generate answer submissions for a bot.
 * Always selects answer index 0 (the first answer) for each question.
 * Used by the bot opponent in tests.
 *
 * @param {string[]} questionIds - IDs of questions to answer.
 * @param {Object} questionsDb - Database containing question definitions.
 * @returns {Array<{questionId:string,answerIdx:number}>} Answer submissions.
 */
export function botAnswer(state, questionsDb) {
  const qId = state.pendingTurn?.questionId;
  const q = questionsDb?._byId?.[qId];
  return { answerIdx: q?.a ?? 0 };
}

/**
 * Reset per-turn flags and rebuild the set of pegs that can move this turn.
 * Called when a turn ends (whether by completion, elimination, or flag capture).
 *
 * Note: Question tracking (usedQ, wrongQ) persists across the entire game session
 * to prevent repeats even across turns. This is handled server-side only.
 */
function resetTurnState(state) {
  state.pendingTurn = null;
  state.selectedPegId = null;
  state.movesRemaining = 3;
  state.phase = PHASE.SELECT_PEG;
}

function advanceTurn(state) {
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

export function createGame(players, settings = {}) {
  const { boardSize = 7, enabledCats, boardLayout } = settings;
  const activeCats = enabledCats?.length ? enabledCats : CATS;
  const numPlayers = players.length;
  const layoutMap = boardLayout || generateLayoutMap(boardSize, activeCats);
  const cornerMap = getCornerOwnerMap(numPlayers, boardSize);

  const board = Array.from({ length: boardSize }, (_outer, rowIdx) =>
    Array.from({ length: boardSize }, (_inner, colIdx) => {
      const val = layoutMap[rowIdx][colIdx];
      return {
        category: val === 'F' ? 'flag' : activeCats[val],
        pegId: null,
        cornerOwner: val === 'F' ? cornerMap[`${rowIdx},${colIdx}`] : null,
      };
    }),
  );

  const pegs = {};
  let pegIdx = 0;
  const startPositions = getStartPositions(numPlayers, boardSize);

  const gamePlayers = players.map((p, i) => {
    const pegIds = [];
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
       pegIds,
       userId: p.userId ?? null,
       stats: { byCategory: {}, gamesPlayed: 0, gamesWon: 0 },
     };
  });

  const state = {
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
    usedQ: Object.fromEntries(CATS.map((c) => [c, new Set()])),
    wrongQ: new Set(),
  };
  return state;
}
