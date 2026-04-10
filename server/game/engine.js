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
  'visual_arts',
  'music',
  'death_metal',
  'film_tv',
  'books',
  'science',
  'history',
  'geography',
  'sports',
  'other',
];

function getRankUpThreshold(boardSize) {
  return boardSize > 8 ? 5 : 3;
}
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

function rankUp(state, pegId) {
  const peg = state.pegs[pegId];
  if (peg.rank < 2) {
    peg.rank++;
    peg.correct = 0;
  }
}

// Returns true if peg was already rank 0 (should be eliminated)
function rankDown(state, pegId) {
  const peg = state.pegs[pegId];
  if (peg.rank > 0) {
    peg.rank--;
    peg.correct = 0;
    return false;
  }
  return true;
}

function pushPegAway(state, pegId, pushDir = null) {
  const peg = state.pegs[pegId];
  if (!peg) {
    return;
  }

  if (!pushDir || (pushDir[0] === 0 && pushDir[1] === 0)) {
    eliminatePeg(state, pegId);
    return;
  }

  const [pushDr, pushDc] = pushDir;
  const { row: pegR, col: pegC } = peg;

  // Chain push: push all pegs in direction until empty space or off board
  const pushedPegs = [pegId];
  let curR = pegR + pushDr;
  let curC = pegC + pushDc;

  while (
    curR >= 0 &&
    curR < state.boardSize &&
    curC >= 0 &&
    curC < state.boardSize
  ) {
    const tile = state.board[curR][curC];
    if (tile.pegId) {
      pushedPegs.push(tile.pegId);
      curR += pushDr;
      curC += pushDc;
    } else {
      break;
    }
  }

  // If final position is off board, eliminate the last peg
  if (
    curR < 0 ||
    curR >= state.boardSize ||
    curC < 0 ||
    curC >= state.boardSize
  ) {
    const lastPegId = pushedPegs.pop();
    eliminatePeg(state, lastPegId);
  }

  // Move all pushed pegs one step in direction
  for (let i = pushedPegs.length - 1; i >= 0; i--) {
    const pid = pushedPegs[i];
    const p = state.pegs[pid];
    movePeg(state, pid, p.row + pushDr, p.col + pushDc);
  }
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

function getEligiblePegs(state) {
  return state.players[state.currentPlayerIdx].pegIds.filter(
    (id) => getValidMoves(state, id).length > 0,
  );
}

// Called after a peg finishes its moves (wrong answer, movesRemaining=0, or flag fail).
// Removes peg from pegsToMove. Advances turn when set empties.
function finishPegMove(state) {
  state.pegsToMove.delete(state.selectedPegId);
  state.selectedPegId = null;
  state.movesRemaining = 0;
  state.pendingTurn = null;
  if (state.pegsToMove.size === 0) {
    advanceTurn(state);
  } else {
    state.phase = PHASE.SELECT_PEG;
  }
}

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
  // tileCat matches tileCat(): flag tiles use 'other' for normal moves
  const tileCat =
    tile.category === 'flag' ? 'other' : tile.category;
  const selectedIds = new Set();
  const take = (cat, count = 1) => {
    const ids = pickQuestionIds(state, cat, count, questionsDb, selectedIds);
    ids.forEach((id) => selectedIds.add(id));
    return ids;
  };

  let questionIds;
  if (moveType === 'flag') {
    // Each of the 3 flag capture questions uses a fresh randomCat()
    questionIds = [
      ...take(randomCat(state.enabledCats), 1),
      ...take(randomCat(state.enabledCats), 1),
      ...take(randomCat(state.enabledCats), 1),
    ];
  } else if (moveType === 'combat') {
    // Q1 uses the tile's category (matching tileCat), Q2 uses random category
    const combatQ1Cat = tile.category === 'flag' ? 'other' : tile.category;
    const combatQ2Cat = randomCat(state.enabledCats);
    questionIds = [
      ...take(combatQ1Cat, 1),
      ...take(combatQ2Cat, 1),
    ];
  } else {
    questionIds = take(tileCat, 1);
  }

  state.pendingTurn = { pegId, targetR, targetC, moveType, questionIds };
  return { moveType, questionIds };
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
  if (!state.pegsToMove.has(pegId)) {
    return { error: 'Peg already moved this turn' };
  }

  const moves = getValidMoves(state, pegId);
  if (moves.length === 0) {
    return { error: 'No valid moves' };
  }

  const peg = state.pegs[pegId];
  state.pendingTurn = null;
  state.selectedPegId = pegId;
  state.movesRemaining = peg.rank + 1;
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

export function applyTurn(state, playerId, submission, questionsDb) {
   const pending = state.pendingTurn;
   if (!pending) {
     return { error: 'No pending turn' };
   }
    const currentPlayer = state.players[state.currentPlayerIdx];
    if (currentPlayer.id !== playerId) {
      return { error: 'Not your turn' };
    }

  const { pegId, targetR, targetC, moveType, questionIds } = pending;

  if (submission.pegId !== pegId) {
    return { error: 'Peg mismatch' };
  }
  if (submission.targetR !== targetR || submission.targetC !== targetC) {
    return { error: 'Target mismatch' };
  }

  // For combat with sequential questions: if only Q1 submitted, keep pendingTurn for Q2
  const answers = submission.answers || [];
  const numSubmitted = answers.length;
  const totalQuestions = questionIds.length;
  const hasMoreQuestions = numSubmitted < totalQuestions && numSubmitted > 0;

  // General rule: if more questions remain and only partial answers submitted, wait for results
  // Don't clear pendingTurn so player can answer remaining questions after results are shown
  if (!hasMoreQuestions) {
    state.pendingTurn = null;
  }

  const events = [];

  const checkAnswer = (idx) => {
    // Don't process answers that haven't been submitted yet
    if (idx >= numSubmitted) {
      return false;
    }
    const qId = questionIds[idx];
    const q = questionsDb._byId?.[qId];
    const ans = answers[idx];
    if (!q || ans === undefined) {
      return false;
    }
    const correct = q.a === ans.answerIdx;
    events.push({ type: 'answer', questionId: qId, correct });
    if (!correct) {
      state.wrongQ.add(qId);
    }
    const cp = state.players[state.currentPlayerIdx];
    if (cp?.stats) {
      const cat = q.category || 'unknown';
      if (!cp.stats.byCategory) { cp.stats.byCategory = {}; }
      if (!cp.stats.byCategory[cat]) { cp.stats.byCategory[cat] = { attempts: 0, correct: 0 }; }
      cp.stats.byCategory[cat].attempts++;
      if (correct) {
        cp.stats.byCategory[cat].correct++;
      }
    }
    return correct;
  };

  if (moveType === 'normal') {
    const peg = state.pegs[pegId];
    if (checkAnswer(0)) {
      movePeg(state, pegId, targetR, targetC);
      peg.correct++;
      if (peg.correct >= getRankUpThreshold(state.boardSize)) {
        rankUp(state, pegId);
        events.push({ type: 'rank_up', pegId });
      }
      events.push({ type: 'peg_moved', pegId, r: targetR, c: targetC });
    }
    // Always decrement movesRemaining
    state.movesRemaining--;
    if (state.movesRemaining > 0 && getValidMoves(state, pegId).length > 0) {
      state.phase = PHASE.SELECT_TILE;
      return { ok: true, events, gameOver: false };
    }
    // No moves remaining: finish this peg
    finishPegMove(state);
  } else if (moveType === 'combat') {
    const atkPeg = state.pegs[pegId];
    const pushDir = atkPeg
      ? [targetR - atkPeg.row, targetC - atkPeg.col]
      : null;

    const q1Correct = checkAnswer(0);
    if (q1Correct) {
      const q2Correct = checkAnswer(1);
      const defPegId = state.board[targetR]?.[targetC]?.pegId;
      const defPeg = defPegId ? state.pegs[defPegId] : null;
      if (q2Correct && defPeg) {
        // Attacker wins only if both Q1 and Q2 are correct
        const wasElim = rankDown(state, defPegId);
        if (wasElim) {
          eliminatePeg(state, defPegId);
          events.push({ type: 'peg_eliminated', pegId: defPegId });
        } else {
          pushPegAway(state, defPegId, pushDir);
          events.push({
            type: 'peg_pushed',
            pegId: defPegId,
            r: state.pegs[defPegId]?.row,
            c: state.pegs[defPegId]?.col,
          });
          events.push({ type: 'rank_down', pegId: defPegId });
        }
        movePeg(state, pegId, targetR, targetC);
        events.push({ type: 'peg_moved', pegId, r: targetR, c: targetC });
      }
       }
       // Combat always ends turn (win or lose)
       const combatWinner = checkWinCondition(state);
       if (combatWinner >= 0) {
         // Update game stats for all players
         state.players.forEach((player, index) => {
           player.stats.gamesPlayed++;
           if (index === combatWinner) {
             player.stats.gamesWon++;
           }
         });
         state.phase = PHASE.GAME_OVER;
         state.winner = combatWinner;
         return { ok: true, events, gameOver: true, winner: combatWinner };
       }
    advanceTurn(state);
    return { ok: true, events, gameOver: false };
  } else if (moveType === 'flag') {
    // Check all 3 answers individually — don't short-circuit so each is recorded in state.wrongQ
    const a0 = checkAnswer(0);
    const a1 = checkAnswer(1);
    const a2 = checkAnswer(2);
    const allCorrect = a0 && a1 && a2;
      if (allCorrect) {
        movePeg(state, pegId, targetR, targetC);
        events.push({ type: 'peg_moved', pegId, r: targetR, c: targetC });
        events.push({ type: 'flag_captured', pegId, playerId });
        // Update game stats for all players
        state.players.forEach((player, index) => {
          player.stats.gamesPlayed++;
          if (index === playerId) {
            player.stats.gamesWon++;
          }
        });
        state.phase = PHASE.GAME_OVER;
        state.winner = playerId;
        return { ok: true, events, gameOver: true, winner: playerId };
      } else {
        finishPegMove(state);
      }
  }

  // Check elimination win (normal and flag paths)
  const winner = checkWinCondition(state);
  if (winner >= 0) {
    state.phase = PHASE.GAME_OVER;
    state.winner = winner;
    return { ok: true, events, gameOver: true, winner };
  }

  return { ok: true, events, gameOver: false };
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
export function botSelectAnswers(questionIds, questionsDb) {
  return questionIds.map(qid => {
    const q = questionsDb?._byId?.[qid];
    // In our test fixtures the correct answer is always at index 0.
    // If for some reason the question is missing, we still return index 0.
    return { questionId: qid, answerIdx: q?.a ?? 0 };
  });
}

/**
 * Reset per-turn flags and rebuild the set of pegs that can move this turn.
 * Called when a turn ends (whether by completion, elimination, or flag capture).
 */
function resetTurnState(state) {
  // Clear per-turn flags
  state.pendingTurn = null;
  state.selectedPegId = null;
  state.movesRemaining = 0;

  // Rebuild pegsToMove based on freshly computed eligible pegs
  state.pegsToMove = new Set(getEligiblePegs(state));

  // Clear question-tracking collections
  for (const cat of Object.keys(state.usedQ)) {
    state.usedQ[cat].clear();
  }
  state.wrongQ.clear();

  // Reset phase to SELECT_PEG
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
  const { boardSize = 7, enabledCats, maxRankStart = false, boardLayout } = settings;
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
        rank: maxRankStart ? 2 : 0,
        correct: 0,
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
    movesRemaining: 0,
    pegsToMove: new Set(),
    winner: null,
    enabledCats: activeCats,
    usedQ: Object.fromEntries(CATS.map((c) => [c, new Set()])),
    wrongQ: new Set(),
  };
  state.pegsToMove = new Set(getEligiblePegs(state));
  return state;
}
