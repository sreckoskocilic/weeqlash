// Pure game logic — no DOM, no globals, all functions take state as first arg.
// Extracted and adapted from srazique/index.clean.html

export const PHASE = {
  SELECT_PEG: 'selectPeg',
  SELECT_TILE: 'selectTile',
  GAME_OVER:   'gameOver',
};

export const CATS = [
  'art','geography','history','literature','science',
  'business','sport','religion','entertainment','general'
];

function getRankUpThreshold(boardSize) { return boardSize > 8 ? 5 : 3; }
export const COORD_BASE  = 100;
const DIRS              = [[-1,0],[1,0],[0,-1],[0,1]];

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

function randomCat(enabledCats) {
  const cats = enabledCats?.length ? enabledCats : CATS;
  return cats[Math.floor(Math.random() * cats.length)];
}

// ---------------------------------------------------------------------------
// Board helpers
// ---------------------------------------------------------------------------

function adjTiles(state, r, c) {
  return DIRS
    .map(([dr, dc]) => ({ r: r + dr, c: c + dc }))
    .filter(p => p.r >= 0 && p.r < state.boardSize && p.c >= 0 && p.c < state.boardSize);
}

export function getValidMoves(state, pegId) {
  const peg = state.pegs[pegId];
  if (!peg) {return [];}
  return adjTiles(state, peg.row, peg.col).filter(({ r, c }) => {
    const tile = state.board[r][c];
    // Can't move back onto own flag corner
    if (tile.category === 'flag' && tile.cornerOwner === peg.playerId) {return false;}
    const occ = tile.pegId;
    // Can move to empty tile or tile occupied by enemy
    return !occ || state.pegs[occ].playerId !== peg.playerId;
  });
}

function generateLayoutMap(boardSize) {
  const isCorner = (r, c) =>
    (r === 0 || r === boardSize - 1) && (c === 0 || c === boardSize - 1);
  const useFlagCorners = boardSize > 4;
  const nonCorner = [];
  const map = Array.from({ length: boardSize }, () => Array(boardSize).fill(null));

  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      if (isCorner(r, c) && useFlagCorners) {map[r][c] = 'F';}
      else {nonCorner.push([r, c]);}
    }
  }
  const pool = shuffle(Array.from({ length: nonCorner.length }, (_, i) => i % CATS.length));
  nonCorner.forEach(([r, c], i) => { map[r][c] = pool[i]; });
  return map;
}

function getCornerOwnerMap(numPlayers, boardSize) {
  if (boardSize === 4) {return {};}
  const S = boardSize - 1;
  const map = { '0,0': 0 };
  if (numPlayers === 2)      { map[`${S},${S}`] = 1; }
  else if (numPlayers === 3) { map[`0,${S}`] = 1; map[`${S},${S}`] = 2; }
  else                       { map[`0,${S}`] = 1; map[`${S},0`] = 2; map[`${S},${S}`] = 3; }
  return map;
}

function getStartPositions(numPlayers, boardSize) {
  const S = boardSize - 1;
  if (boardSize === 4) {
    const corners = [[{r:0,c:0}],[{r:0,c:S}],[{r:S,c:0}],[{r:S,c:S}]];
    if (numPlayers === 2) {return [corners[0], corners[3]];}
    if (numPlayers === 3) {return [corners[0], corners[1], corners[3]];}
    return corners;
  }
  const all = [
    [{r:1,c:0},{r:0,c:1},{r:1,c:1}],
    [{r:1,c:S},{r:0,c:S-1},{r:1,c:S-1}],
    [{r:S-1,c:0},{r:S,c:1},{r:S-1,c:1}],
    [{r:S-1,c:S},{r:S,c:S-1},{r:S-1,c:S-1}],
  ];
  if (numPlayers === 2) {return [all[0], all[3]];}
  if (numPlayers === 3) {return [all[0], all[1], all[3]];}
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
  state.players[peg.playerId].pegIds =
    state.players[peg.playerId].pegIds.filter(id => id !== pegId);
}

function rankUp(state, pegId) {
  const peg = state.pegs[pegId];
  if (peg.rank < 2) { peg.rank++; peg.correct = 0; }
}

// Returns true if peg was already rank 0 (should be eliminated)
function rankDown(state, pegId) {
  const peg = state.pegs[pegId];
  if (peg.rank > 0) { peg.rank--; peg.correct = 0; return false; }
  return true;
}

function pushPegAway(state, pegId) {
  const peg  = state.pegs[pegId];
  const free = adjTiles(state, peg.row, peg.col)
    .filter(p => state.board[p.r][p.c].pegId === null);
  if (free.length === 0) {eliminatePeg(state, pegId);}
  else {movePeg(state, pegId, free[0].r, free[0].c);}
}

// ---------------------------------------------------------------------------
// Win condition
// ---------------------------------------------------------------------------

export function checkWinCondition(state) {
  let survivor = -1, living = 0;
  for (const p of state.players) {
    if (p.pegIds.length > 0) { survivor = p.id; living++; }
  }
  return living === 1 ? survivor : -1;
}

// ---------------------------------------------------------------------------
// Turn helpers (match desktop game mechanics)
// ---------------------------------------------------------------------------

function getEligiblePegs(state) {
  return state.players[state.currentPlayerIdx].pegIds.filter(
    id => getValidMoves(state, id).length > 0
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
function pickQuestionIds(state, cat, count, questionsDb) {
  const pool = questionsDb[cat];
  if (!pool?.length) {return [];}

  if (!state.usedQ[cat]) {state.usedQ[cat] = new Set();}
  const usedSet  = state.usedQ[cat];
  const wrongSet = state.wrongQ;

  let candidates = pool.filter(q => !usedSet.has(q.id) && !wrongSet.has(q.id));
  if (candidates.length < count) {
    usedSet.clear();
    candidates = pool.filter(q => !wrongSet.has(q.id));
  }
  if (candidates.length < count) {
    candidates = pool.filter(q => !usedSet.has(q.id));
    if (candidates.length < count) { usedSet.clear(); candidates = [...pool]; }
  }
  candidates = shuffle(candidates);

  const selected = candidates.slice(0, count);
  selected.forEach(q => usedSet.add(q.id));
  return selected.map(q => q.id);
}

// Determine move type from board state
function getMoveType(state, pegId, r, c) {
  const tile = state.board[r][c];
  if (tile.category === 'flag') {return 'flag';}
  if (tile.pegId && state.pegs[tile.pegId].playerId !== state.pegs[pegId].playerId) {return 'combat';}
  return 'normal';
}

// ---------------------------------------------------------------------------
// Public: plan questions for a pending move
// Called when player selects a tile. Returns { moveType, questionIds }
// and records the pending turn on state for later validation.
// ---------------------------------------------------------------------------

export function planTurnQuestions(state, pegId, targetR, targetC, questionsDb) {
  const tile     = state.board[targetR][targetC];
  const moveType = getMoveType(state, pegId, targetR, targetC);
  const tileCat  = (tile.category === 'flag') ? randomCat(state.enabledCats) : tile.category;

  let questionIds;
  if (moveType === 'flag')   {questionIds = pickQuestionIds(state, tileCat, 3, questionsDb);}
  else if (moveType === 'combat') {questionIds = pickQuestionIds(state, randomCat(state.enabledCats), 2, questionsDb);}
  else                       {questionIds = pickQuestionIds(state, tileCat, 1, questionsDb);}

  state.pendingTurn = { pegId, targetR, targetC, moveType, questionIds };
  return { moveType, questionIds };
}

// ---------------------------------------------------------------------------
// Public: validate peg selection
// ---------------------------------------------------------------------------

export function selectPeg(state, playerId, pegId) {
  if (state.phase !== PHASE.SELECT_PEG && state.phase !== PHASE.SELECT_TILE)
    {return { error: 'Wrong phase' };}
  const player = state.players[state.currentPlayerIdx];
  if (player.id !== playerId) {return { error: 'Not your turn' };}
  if (!player.pegIds.includes(pegId)) {return { error: 'Not your peg' };}
  if (!state.pegsToMove.has(pegId)) {return { error: 'Peg already moved this turn' };}

  const moves = getValidMoves(state, pegId);
  if (moves.length === 0) {return { error: 'No valid moves' };}

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
  if (!pending) {return { error: 'No pending turn' };}

  const player = state.players[state.currentPlayerIdx];
  if (player.id !== playerId) {return { error: 'Not your turn' };}

  const { pegId, targetR, targetC, moveType, questionIds } = pending;

  if (submission.pegId !== pegId)
    {return { error: 'Peg mismatch' };}
  if (submission.targetR !== targetR || submission.targetC !== targetC)
    {return { error: 'Target mismatch' };}

  state.pendingTurn = null;
  const answers = submission.answers || [];
  const events  = [];

  const checkAnswer = (idx) => {
    const qId = questionIds[idx];
    const q   = questionsDb._byId?.[qId];
    const ans = answers[idx];
    if (!q || ans === undefined) {return false;}
    const correct = q.a === ans.answerIdx;
    events.push({ type: 'answer', questionId: qId, correct });
    if (!correct) {state.wrongQ.add(qId);}
    const cp = state.players[state.currentPlayerIdx];
    if (cp?.stats) { cp.stats.attempts++; if (correct) {cp.stats.correct++;} }
    return correct;
  };

  if (moveType === 'normal') {
    if (checkAnswer(0)) {
      const peg = state.pegs[pegId];
      movePeg(state, pegId, targetR, targetC);
      peg.correct++;
      if (peg.correct >= getRankUpThreshold(state.boardSize)) { rankUp(state, pegId); events.push({ type: 'rank_up', pegId }); }
      events.push({ type: 'peg_moved', pegId, r: targetR, c: targetC });
      state.movesRemaining--;
      // If moves remain and peg can still move, keep SELECT_TILE for same peg
      if (state.movesRemaining > 0 && getValidMoves(state, pegId).length > 0) {
        state.phase = PHASE.SELECT_TILE;
        return { ok: true, events, gameOver: false };
      }
    }
    // Wrong answer or no moves remaining: finish this peg
    finishPegMove(state);

  } else if (moveType === 'combat') {
    const q1Correct = checkAnswer(0);
    const q2Correct = checkAnswer(1);
    if (q1Correct) {
      const defPegId = state.board[targetR][targetC].pegId;
      const defPeg   = state.pegs[defPegId];
      const atkPeg   = state.pegs[pegId];
      const rankWin  = atkPeg && defPeg && atkPeg.rank > defPeg.rank;
      if (q2Correct) {
        rankUp(state, pegId);
        events.push({ type: 'rank_up', pegId });
      }
      if (q2Correct || rankWin) {
        const wasElim = rankDown(state, defPegId);
        if (wasElim) {
          eliminatePeg(state, defPegId);
          events.push({ type: 'peg_eliminated', pegId: defPegId });
        } else {
          pushPegAway(state, defPegId);
          events.push({ type: 'peg_pushed', pegId: defPegId, r: state.pegs[defPegId]?.row, c: state.pegs[defPegId]?.col });
          events.push({ type: 'rank_down', pegId: defPegId });
        }
        movePeg(state, pegId, targetR, targetC);
        events.push({ type: 'peg_moved', pegId, r: targetR, c: targetC });
      }
    }
    // Combat always ends turn (win or lose)
    const combatWinner = checkWinCondition(state);
    if (combatWinner >= 0) {
      state.phase  = PHASE.GAME_OVER;
      state.winner = combatWinner;
      return { ok: true, events, gameOver: true, winner: combatWinner };
    }
    advanceTurn(state);
    return { ok: true, events, gameOver: false };

  } else if (moveType === 'flag') {
    const allCorrect = checkAnswer(0) && checkAnswer(1) && checkAnswer(2);
    if (allCorrect) {
      movePeg(state, pegId, targetR, targetC);
      events.push({ type: 'peg_moved', pegId, r: targetR, c: targetC });
      events.push({ type: 'flag_captured', pegId, playerId });
      state.phase  = PHASE.GAME_OVER;
      state.winner = playerId;
      return { ok: true, events, gameOver: true, winner: playerId };
    } else {
      const wasElim = rankDown(state, pegId);
      if (wasElim) {
        eliminatePeg(state, pegId);
        events.push({ type: 'peg_eliminated', pegId });
      } else {
        events.push({ type: 'rank_down', pegId });
      }
      finishPegMove(state);
    }
  }

  // Check elimination win (normal and flag paths)
  const winner = checkWinCondition(state);
  if (winner >= 0) {
    state.phase  = PHASE.GAME_OVER;
    state.winner = winner;
    return { ok: true, events, gameOver: true, winner };
  }

  return { ok: true, events, gameOver: false };
}

// ---------------------------------------------------------------------------
// Turn management
// ---------------------------------------------------------------------------

function advanceTurn(state) {
  let next = (state.currentPlayerIdx + 1) % state.numPlayers;
  let tries = 0;
  while (state.players[next].pegIds.length === 0 && tries < state.numPlayers) {
    next = (next + 1) % state.numPlayers;
    tries++;
  }
  state.currentPlayerIdx = next;
  state.phase = PHASE.SELECT_PEG;
  state.selectedPegId = null;
  state.pendingTurn = null;
  state.movesRemaining = 0;
  state.pegsToMove = new Set(getEligiblePegs(state));
}

// ---------------------------------------------------------------------------
// Public: create initial game state
// ---------------------------------------------------------------------------

export function createGame(players, settings) {
  const { boardSize = 7, enabledCats, maxRankStart = false } = settings;
  const activeCats = enabledCats?.length ? enabledCats : CATS;
  const numPlayers  = players.length;
  const layoutMap   = generateLayoutMap(boardSize);
  const cornerMap   = getCornerOwnerMap(numPlayers, boardSize);

  const board = Array.from({ length: boardSize }, (_, r) =>
    Array.from({ length: boardSize }, (_, c) => {
      const val = layoutMap[r][c];
      return {
        category:    val === 'F' ? 'flag' : CATS[val],
        pegId:       null,
        cornerOwner: val === 'F' ? cornerMap[`${r},${c}`] : null,
      };
    })
  );

  const pegs = {};
  let pegIdx = 0;
  const startPositions = getStartPositions(numPlayers, boardSize);

  const gamePlayers = players.map((p, i) => {
    const pegIds = [];
    for (const pos of startPositions[i]) {
      const id = `p${i}_${pegIdx++}`;
      pegs[id] = { id, playerId: i, row: pos.r, col: pos.c, rank: maxRankStart ? 2 : 0, correct: 0 };
      board[pos.r][pos.c].pegId = id;
      pegIds.push(id);
    }
    return { id: i, name: p.name, color: p.color, pegIds, stats: { attempts: 0, correct: 0 } };
  });

  const state = {
    boardSize,
    board,
    pegs,
    players:          gamePlayers,
    numPlayers,
    currentPlayerIdx: 0,
    phase:            PHASE.SELECT_PEG,
    selectedPegId:    null,
    pendingTurn:      null,
    movesRemaining:   0,
    pegsToMove:       new Set(),
    winner:           null,
    enabledCats:      activeCats,
    usedQ:            Object.fromEntries(CATS.map(c => [c, new Set()])),
    wrongQ:           new Set(),
  };
  state.pegsToMove = new Set(getEligiblePegs(state));
  return state;
}
