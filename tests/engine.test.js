import { describe, it, expect } from 'vitest';
import {
  createGame,
  applyTurn,
  selectPeg,
  planTurnQuestions,
  checkWinCondition,
  getValidMoves,
  PHASE,
  CATS,
} from '../server/game/engine.js';

// Helper to create mock questions DB
function createQuestionsDb() {
  const q = {};
  for (const cat of CATS) {
    q[cat] = [
      { id: `${cat}_1`, a: 0, q: 'Test?', opts: ['A', 'B', 'C', 'D'] },
      { id: `${cat}_2`, a: 1, q: 'Test2?', opts: ['A', 'B', 'C', 'D'] },
      { id: `${cat}_3`, a: 2, q: 'Test3?', opts: ['A', 'B', 'C', 'D'] },
    ];
  }
  q._byId = {};
  for (const cat of CATS) {
    for (const qq of q[cat]) {
      q._byId[qq.id] = qq;
    }
  }
  return q;
}

function createSparseQuestionsDb(overrides = {}) {
  const q = Object.fromEntries(CATS.map((cat) => [cat, []]));
  for (const [cat, questions] of Object.entries(overrides)) {
    q[cat] = questions;
  }
  q._byId = {};
  for (const cat of CATS) {
    for (const qq of q[cat]) {
      q._byId[qq.id] = qq;
    }
  }
  return q;
}

describe('Engine: Game Creation', () => {
  it('creates 2 player game', () => {
    const state = createGame(
      [
        { name: 'P1', color: '#f00' },
        { name: 'P2', color: '#00f' },
      ],
      { boardSize: 7 },
    );
    expect(state.numPlayers).toBe(2);
    expect(state.players).toHaveLength(2);
    expect(state.boardSize).toBe(7);
    expect(state.phase).toBe(PHASE.SELECT_PEG);
  });

  it('creates 4 player game', () => {
    const players = [
      { name: 'P1', color: '#f00' },
      { name: 'P2', color: '#00f' },
      { name: 'P3', color: '#0f0' },
      { name: 'P4', color: '#ff0' },
    ];
    const state = createGame(players, { boardSize: 7 });
    expect(state.numPlayers).toBe(4);
  });

  it('creates 2x2 board with 1 peg per player', () => {
    const state = createGame(
      [
        { name: 'P1', color: '#f00' },
        { name: 'P2', color: '#00f' },
      ],
      { boardSize: 2 }
    );
    expect(state.boardSize).toBe(2);
    expect(state.numPlayers).toBe(2);
    expect(state.players[0].pegIds).toHaveLength(1);
    expect(state.players[1].pegIds).toHaveLength(1);
  });

  it('2x2 board: peg movement and combat', () => {
    const state = createGame(
      [
        { name: 'P1', color: '#f00' },
        { name: 'P2', color: '#00f' },
      ],
      { boardSize: 2 }
    );

    const p1PegId = state.players[0].pegIds[0];
    const p2PegId = state.players[1].pegIds[0];

    // Verify starting positions are diagonal (opposite corners)
    const p1Peg = state.pegs[p1PegId];
    const p2Peg = state.pegs[p2PegId];

    // In 2x2, player 1 should be at (0,0), player 2 at (1,1)
    expect(p1Peg.row).toBe(0);
    expect(p1Peg.col).toBe(0);
    expect(p2Peg.row).toBe(1);
    expect(p2Peg.col).toBe(1);

    // Select P1's peg
    const result = selectPeg(state, 0, p1PegId);
    expect(result.ok).toBe(true);
    expect(result.validMoves).toBeDefined();

    // P1 should have 2 valid moves: (0,1) and (1,0)
    const moves = result.validMoves.map((m) => ({
      r: Math.floor(m / 100),
      c: m % 100,
    }));
    expect(moves).toHaveLength(2);
    expect(moves).toContainEqual({ r: 0, c: 1 });
    expect(moves).toContainEqual({ r: 1, c: 0 });
  });

  it('2x2 board: complete turn with combat', () => {
    const state = createGame(
      [
        { name: 'P1', color: '#f00' },
        { name: 'P2', color: '#00f' },
      ],
      { boardSize: 2 }
    );

    const p1PegId = state.players[0].pegIds[0];
    const p2PegId = state.players[1].pegIds[0];
    const p2Peg = state.pegs[p2PegId];

    // Manually position P1 next to P2 for combat
    state.pegs[p1PegId].row = p2Peg.row;
    state.pegs[p1PegId].col = p2Peg.col - 1;
    state.board[p2Peg.row][p2Peg.col - 1].pegId = p1PegId;
    state.board[p2Peg.row][p2Peg.col].pegId = p2PegId;

    // Select P1's peg
    const selectResult = selectPeg(state, 0, p1PegId);
    expect(selectResult.ok).toBe(true);

    // Plan combat move
    const questionsDb = createQuestionsDb();
    const planResult = planTurnQuestions(state, p1PegId, p2Peg.row, p2Peg.col, questionsDb);
    expect(planResult.moveType).toBe('combat');
    expect(planResult.questionIds).toHaveLength(3);

    // Apply turn with all 3 correct answers to eliminate defender (3 HP)
    const q1Id = planResult.questionIds[0];
    const q2Id = planResult.questionIds[1];
    const q3Id = planResult.questionIds[2];
    const a1 = questionsDb._byId[q1Id].a;
    const a2 = questionsDb._byId[q2Id].a;
    const a3 = questionsDb._byId[q3Id].a;

    const turnResult = applyTurn(
      state,
      0,
      {
        pegId: p1PegId,
        targetR: p2Peg.row,
        targetC: p2Peg.col,
        answers: [
          { questionId: q1Id, answerIdx: a1 },
          { questionId: q2Id, answerIdx: a2 },
          { questionId: q3Id, answerIdx: a3 },
        ],
      },
      questionsDb,
    );

    expect(turnResult.ok).toBe(true);
    expect(turnResult.events).toContainEqual({ type: 'peg_moved', pegId: p1PegId, r: p2Peg.row, c: p2Peg.col });

    // In 2x2 board, when attacker wins combat, defender should be eliminated
    // because they're at rank 0 and there's no space to push them

    // P2 should be eliminated from player's peg list and from the board
    expect(state.players[1].pegIds).not.toContain(p2PegId);
    expect(state.board[p2Peg.row][p2Peg.col].pegId).not.toBe(p2PegId);

    // P1 should now be at the target position
    expect(state.pegs[p1PegId].row).toBe(p2Peg.row);
    expect(state.pegs[p1PegId].col).toBe(p2Peg.col);
    expect(state.board[p2Peg.row][p2Peg.col].pegId).toBe(p1PegId);

    // Should have elimination event
    expect(turnResult.events).toContainEqual({ type: 'peg_eliminated', pegId: p2PegId });

    // Game should be over since P2 has no pegs left
    expect(turnResult.gameOver).toBe(true);
    expect(turnResult.winner).toBe(0);
    expect(state.phase).toBe(PHASE.GAME_OVER);
  });

  it('initializes pegs for each player', () => {
    const state = createGame([
      { name: 'P1', color: '#f00' },
      { name: 'P2', color: '#00f' },
    ]);
    const p1Pegs = state.players[0].pegIds;
    const p2Pegs = state.players[1].pegIds;
    expect(p1Pegs).toHaveLength(3);
    expect(p2Pegs).toHaveLength(3);
  });
});

describe('Engine: Peg Selection', () => {
  it('allows valid peg selection', () => {
    const state = createGame([
      { name: 'P1', color: '#f00' },
      { name: 'P2', color: '#00f' },
    ]);
    const result = selectPeg(state, 0, state.players[0].pegIds[0]);
    expect(result.ok).toBe(true);
    expect(result.validMoves).toBeDefined();
    expect(state.phase).toBe(PHASE.SELECT_TILE);
  });

  it('rejects peg not belonging to player', () => {
    const state = createGame([
      { name: 'P1', color: '#f00' },
      { name: 'P2', color: '#00f' },
    ]);
    const p2Peg = state.players[1].pegIds[0];
    const result = selectPeg(state, 0, p2Peg);
    expect(result.error).toBe('Not your peg');
  });

  it('rejects peg when not player turn', () => {
    const state = createGame([
      { name: 'P1', color: '#f00' },
      { name: 'P2', color: '#00f' },
    ]);
    const p1Peg = state.players[0].pegIds[0];
    const result = selectPeg(state, 1, p1Peg);
    expect(result.error).toBe('Not your turn');
  });
});

describe('Engine: Normal Move', () => {
  it('moves peg on correct answer', () => {
    const state = createGame([
      { name: 'P1', color: '#f00' },
      { name: 'P2', color: '#00f' },
    ]);
    const pegId = state.players[0].pegIds[0];
    const origRow = state.pegs[pegId].row;
    const origCol = state.pegs[pegId].col;

    const result = selectPeg(state, 0, pegId);
    expect(result.ok).toBe(true);

    const moves = result.validMoves.map((m) => ({
      r: Math.floor(m / 100),
      c: m % 100,
    }));
    const target = moves[0];

    planTurnQuestions(state, pegId, target.r, target.c, createQuestionsDb());

    // Use correct answer from question DB
    const qId = state.pendingTurn.questionIds[0];
    const questionsDb = createQuestionsDb();
    const correctIdx = questionsDb._byId[qId].a;

    const turnResult = applyTurn(
      state,
      0,
      {
        pegId,
        targetR: target.r,
        targetC: target.c,
        answers: [{ questionId: qId, answerIdx: correctIdx }],
      },
      questionsDb,
    );

    expect(turnResult.ok).toBe(true);
    expect(state.board[origRow][origCol].pegId).not.toBe(pegId);
    expect(state.board[target.r][target.c].pegId).toBe(pegId);
  });

  it('fails move on wrong answer — returns to peg selection', () => {
    const state = createGame([
      { name: 'P1', color: '#f00' },
      { name: 'P2', color: '#00f' },
    ]);
    const pegId = state.players[0].pegIds[0];
    const questionsDb = createQuestionsDb();

    const result = selectPeg(state, 0, pegId);
    expect(result.ok).toBe(true);

    const moves = result.validMoves.map((m) => ({
      r: Math.floor(m / 100),
      c: m % 100,
    }));
    const target = moves[0];

    planTurnQuestions(state, pegId, target.r, target.c, questionsDb);

    const qId = state.pendingTurn.questionIds[0];
    const correctIdx = questionsDb._byId[qId].a;
    const wrongIdx = (correctIdx + 1) % 4;

    const turnResult = applyTurn(
      state,
      0,
      {
        pegId,
        targetR: target.r,
        targetC: target.c,
        answers: [{ questionId: qId, answerIdx: wrongIdx }],
      },
      questionsDb,
    );

    expect(turnResult.ok).toBe(true);
    expect(state.phase).toBe(PHASE.SELECT_PEG);
  });
});

describe('Engine: Question Selection', () => {
  it('falls back to any available question when the target category is empty', () => {
    // Hardcode boardLayout to ensure all tiles are 'history' (index 0)
    const boardLayout = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    const state = createGame(
      [
        { name: 'P1', color: '#f00' },
        { name: 'P2', color: '#00f' },
      ],
      { boardSize: 4, enabledCats: ['history'], boardLayout },
    );
    const questionsDb = createSparseQuestionsDb({
      science: [
        { id: 'science_1', a: 0, q: 'Fallback?', opts: ['A', 'B', 'C', 'D'] },
      ],
    });
    const pegId = state.players[0].pegIds[0];

    const result = selectPeg(state, 0, pegId);
    expect(result.ok).toBe(true);

    const target = result.validMoves
      .map((m) => ({ r: Math.floor(m / 100), c: m % 100 }))
      .find(({ r, c }) => state.board[r][c].category === 'history');

    expect(target).toBeDefined();

    const planResult = planTurnQuestions(state, pegId, target.r, target.c, questionsDb);

    expect(planResult.questionIds).toEqual(['science_1']);
    expect(state.pendingTurn.questionIds).toEqual(['science_1']);
  });

  it('reuses questions instead of returning fewer ids once a category is consumed', () => {
    // Hardcode boardLayout to ensure all tiles are 'history' (index 0)
    const boardLayout = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    const state = createGame(
      [
        { name: 'P1', color: '#f00' },
        { name: 'P2', color: '#00f' },
      ],
      { boardSize: 4, enabledCats: ['history'], boardLayout },
    );
    const questionsDb = createSparseQuestionsDb({
      history: [
        { id: 'history_1', a: 0, q: 'Only one?', opts: ['A', 'B', 'C', 'D'] },
      ],
    });
    const pegId = state.players[0].pegIds[0];

    const result = selectPeg(state, 0, pegId);
    expect(result.ok).toBe(true);

    const target = result.validMoves
      .map((m) => ({ r: Math.floor(m / 100), c: m % 100 }))
      .find(({ r, c }) => state.board[r][c].category === 'history');

    expect(target).toBeDefined();

    const first = planTurnQuestions(state, pegId, target.r, target.c, questionsDb);
    const second = planTurnQuestions(state, pegId, target.r, target.c, questionsDb);

    expect(first.questionIds).toEqual(['history_1']);
    expect(second.questionIds).toEqual(['history_1']);
  });
});

describe('Engine: Combat - Bug Fix Validation', () => {
  it('attacker loses if Q1 wrong (battle ends immediately)', () => {
    const state = createGame([
      { name: 'P1', color: '#f00' },
      { name: 'P2', color: '#00f' },
    ]);

    const p1PegId = state.players[0].pegIds[0];
    const p2PegId = state.players[1].pegIds[0];
    const p2Peg = state.pegs[p2PegId];

    // Clear old position before moving
    const p1OrigRow = state.pegs[p1PegId].row;
    const p1OrigCol = state.pegs[p1PegId].col;
    state.board[p1OrigRow][p1OrigCol].pegId = null;

    // Position P1 next to P2
    state.pegs[p1PegId].row = p2Peg.row;
    state.pegs[p1PegId].col = p2Peg.col - 1;
    state.board[p2Peg.row][p2Peg.col - 1].pegId = p1PegId;

    selectPeg(state, 0, p1PegId);
    const questionsDb = createQuestionsDb();
    planTurnQuestions(
      state,
      p1PegId,
      p2Peg.row,
      p2Peg.col,
      questionsDb,
    );

    const q1Id = state.pendingTurn.questionIds[0];
    const q2Id = state.pendingTurn.questionIds[1];
    const a1 = questionsDb._byId[q1Id].a;
    const wrongA1 = (a1 + 1) % 4; // Ensure it's wrong

    const result = applyTurn(
      state,
      0,
      {
        pegId: p1PegId,
        targetR: p2Peg.row,
        targetC: p2Peg.col,
        answers: [
          { questionId: q1Id, answerIdx: wrongA1 }, // Wrong
          { questionId: q2Id, answerIdx: 0 },
        ],
      },
      questionsDb,
    );

    expect(result.ok).toBe(true);
    expect(state.board[p2Peg.row][p2Peg.col].pegId).toBe(p2PegId);
  });

  it('attacker loses if Q2 wrong (Q1 correct)', () => {
    const state = createGame([
      { name: 'P1', color: '#f00' },
      { name: 'P2', color: '#00f' },
    ]);

    const p1PegId = state.players[0].pegIds[0];
    const p2PegId = state.players[1].pegIds[0];
    const p2Peg = state.pegs[p2PegId];

    state.pegs[p1PegId].row = p2Peg.row;
    state.pegs[p1PegId].col = p2Peg.col - 1;
    state.board[p2Peg.row][p2Peg.col - 1].pegId = p1PegId;

    selectPeg(state, 0, p1PegId);
    const questionsDb = createQuestionsDb();
    planTurnQuestions(
      state,
      p1PegId,
      p2Peg.row,
      p2Peg.col,
      questionsDb,
    );

    const q1Id = state.pendingTurn.questionIds[0];
    const q2Id = state.pendingTurn.questionIds[1];
    const a1 = questionsDb._byId[q1Id].a;
    const a2 = questionsDb._byId[q2Id].a;
    const wrongA2 = (a2 + 1) % 4; // Ensure it's wrong

    const result = applyTurn(
      state,
      0,
      {
        pegId: p1PegId,
        targetR: p2Peg.row,
        targetC: p2Peg.col,
        answers: [
          { questionId: q1Id, answerIdx: a1 }, // Correct
          { questionId: q2Id, answerIdx: wrongA2 }, // Wrong
        ],
      },
      questionsDb,
    );

    expect(result.ok).toBe(true);
    expect(state.board[p2Peg.row][p2Peg.col].pegId).toBe(p2PegId);
  });

  it('attacker wins if all 3 questions correct (defender eliminated at 0 HP)', () => {
    const state = createGame([
      { name: 'P1', color: '#f00' },
      { name: 'P2', color: '#00f' },
    ]);

    const p1PegId = state.players[0].pegIds[0];
    const p2PegId = state.players[1].pegIds[0];
    const p2Peg = state.pegs[p2PegId];

    // Position P1 next to P2
    state.pegs[p1PegId].row = p2Peg.row;
    state.pegs[p1PegId].col = p2Peg.col - 1;
    state.board[p2Peg.row][p2Peg.col - 1].pegId = p1PegId;

    selectPeg(state, 0, p1PegId);
    const questionsDb = createQuestionsDb();
    planTurnQuestions(state, p1PegId, p2Peg.row, p2Peg.col, questionsDb);

    const q1Id = state.pendingTurn.questionIds[0];
    const q2Id = state.pendingTurn.questionIds[1];
    const q3Id = state.pendingTurn.questionIds[2];
    const a1 = questionsDb._byId[q1Id].a;
    const a2 = questionsDb._byId[q2Id].a;
    const a3 = questionsDb._byId[q3Id].a;

    const result = applyTurn(
      state,
      0,
      {
        pegId: p1PegId,
        targetR: p2Peg.row,
        targetC: p2Peg.col,
        answers: [
          { questionId: q1Id, answerIdx: a1 },
          { questionId: q2Id, answerIdx: a2 },
          { questionId: q3Id, answerIdx: a3 },
        ],
      },
      questionsDb,
    );

    expect(result.ok).toBe(true);
    // Attacker should have moved to defender's position
    expect(state.board[p2Peg.row][p2Peg.col].pegId).toBe(p1PegId);
  });
});

describe('Engine: Win Condition', () => {
  it('detects winner when only one player remains', () => {
    const state = createGame([
      { name: 'P1', color: '#f00' },
      { name: 'P2', color: '#00f' },
    ]);

    for (const pegId of state.players[1].pegIds) {
      state.board[state.pegs[pegId].row][state.pegs[pegId].col].pegId = null;
    }
    state.players[1].pegIds = [];

    const winner = checkWinCondition(state);
    expect(winner).toBe(0);
  });

  it('returns -1 when multiple players remain', () => {
    const state = createGame([
      { name: 'P1', color: '#f00' },
      { name: 'P2', color: '#00f' },
    ]);
    const winner = checkWinCondition(state);
    expect(winner).toBe(-1);
  });
});

describe('Engine: HP-Based Combat', () => {
  function setupCombatState() {
    const state = createGame([
      { name: 'P1', color: '#f00' },
      { name: 'P2', color: '#00f' },
    ]);
    const p1PegId = state.players[0].pegIds[0];
    const p2PegId = state.players[1].pegIds[0];
    const p2Peg = state.pegs[p2PegId];

    const p1OrigRow = state.pegs[p1PegId].row;
    const p1OrigCol = state.pegs[p1PegId].col;
    state.board[p1OrigRow][p1OrigCol].pegId = null;
    state.pegs[p1PegId].row = p2Peg.row;
    state.pegs[p1PegId].col = p2Peg.col - 1;
    state.board[p2Peg.row][p2Peg.col - 1].pegId = p1PegId;

    selectPeg(state, 0, p1PegId);
    const questionsDb = createQuestionsDb();
    const planResult = planTurnQuestions(state, p1PegId, p2Peg.row, p2Peg.col, questionsDb);

    return { state, p1PegId, p2PegId, p2Peg, questionsDb, planResult };
  }

  it('pegs start with 3 HP', () => {
    const state = createGame([
      { name: 'P1', color: '#f00' },
      { name: 'P2', color: '#00f' },
    ]);
    for (const pegId of Object.keys(state.pegs)) {
      expect(state.pegs[pegId].hp).toBe(3);
    }
  });

  it('combat plans 3 questions', () => {
    const { planResult } = setupCombatState();
    expect(planResult.questionIds).toHaveLength(3);
  });

  it('attacker misses Q1 — combat ends, defender HP unchanged at 3', () => {
    const { state, p1PegId, p2PegId, p2Peg, questionsDb, planResult } = setupCombatState();
    const q1Id = planResult.questionIds[0];
    const wrongA1 = (questionsDb._byId[q1Id].a + 1) % 4;

    const result = applyTurn(state, 0, {
      pegId: p1PegId,
      targetR: p2Peg.row,
      targetC: p2Peg.col,
      answers: [{ questionId: q1Id, answerIdx: wrongA1 }],
    }, questionsDb);

    expect(result.ok).toBe(true);
    expect(state.pegs[p2PegId].hp).toBe(3);
    expect(state.board[p2Peg.row][p2Peg.col].pegId).toBe(p2PegId);
  });

  it('attacker hits Q1+Q2, misses Q3 — defender at 1 HP, survives, turn advances', () => {
    const { state, p1PegId, p2PegId, p2Peg, questionsDb, planResult } = setupCombatState();
    const q1Id = planResult.questionIds[0];
    const q2Id = planResult.questionIds[1];
    const q3Id = planResult.questionIds[2];
    const a1 = questionsDb._byId[q1Id].a;
    const a2 = questionsDb._byId[q2Id].a;
    const wrongA3 = (questionsDb._byId[q3Id].a + 1) % 4;

    const result = applyTurn(state, 0, {
      pegId: p1PegId,
      targetR: p2Peg.row,
      targetC: p2Peg.col,
      answers: [
        { questionId: q1Id, answerIdx: a1 },
        { questionId: q2Id, answerIdx: a2 },
        { questionId: q3Id, answerIdx: wrongA3 },
      ],
    }, questionsDb);

    expect(result.ok).toBe(true);
    expect(state.pegs[p2PegId].hp).toBe(1);
    expect(state.board[p2Peg.row][p2Peg.col].pegId).toBe(p2PegId);
    expect(state.currentPlayerIdx).toBe(1);
  });

  it('attacker hits Q1+Q2+Q3 — defender eliminated, attacker moves in, turn advances', () => {
    const { state, p1PegId, p2PegId, p2Peg, questionsDb, planResult } = setupCombatState();
    const q1Id = planResult.questionIds[0];
    const q2Id = planResult.questionIds[1];
    const q3Id = planResult.questionIds[2];
    const a1 = questionsDb._byId[q1Id].a;
    const a2 = questionsDb._byId[q2Id].a;
    const a3 = questionsDb._byId[q3Id].a;

    const result = applyTurn(state, 0, {
      pegId: p1PegId,
      targetR: p2Peg.row,
      targetC: p2Peg.col,
      answers: [
        { questionId: q1Id, answerIdx: a1 },
        { questionId: q2Id, answerIdx: a2 },
        { questionId: q3Id, answerIdx: a3 },
      ],
    }, questionsDb);

    expect(result.ok).toBe(true);
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'peg_eliminated', pegId: p2PegId }));
    expect(result.events).toContainEqual({ type: 'peg_moved', pegId: p1PegId, r: p2Peg.row, c: p2Peg.col });
    expect(state.board[p2Peg.row][p2Peg.col].pegId).toBe(p1PegId);
  });

  it('combat_hit events emitted with correct hp values', () => {
    const { state, p1PegId, p2PegId, p2Peg, questionsDb, planResult } = setupCombatState();
    const q1Id = planResult.questionIds[0];
    const q2Id = planResult.questionIds[1];
    const q3Id = planResult.questionIds[2];
    const a1 = questionsDb._byId[q1Id].a;
    const a2 = questionsDb._byId[q2Id].a;
    const wrongA3 = (questionsDb._byId[q3Id].a + 1) % 4;

    const result = applyTurn(state, 0, {
      pegId: p1PegId,
      targetR: p2Peg.row,
      targetC: p2Peg.col,
      answers: [
        { questionId: q1Id, answerIdx: a1 },
        { questionId: q2Id, answerIdx: a2 },
        { questionId: q3Id, answerIdx: wrongA3 },
      ],
    }, questionsDb);

    const hitEvents = result.events.filter(e => e.type === 'combat_hit');
    expect(hitEvents).toHaveLength(2);
    expect(hitEvents[0]).toEqual({ type: 'combat_hit', defPegId: p2PegId, hp: 2 });
    expect(hitEvents[1]).toEqual({ type: 'combat_hit', defPegId: p2PegId, hp: 1 });
  });
});

describe('Engine: 3-Move Turn Pool', () => {
  it('movesRemaining starts at 3 at game start', () => {
    const state = createGame([
      { name: 'P1', color: '#f00' },
      { name: 'P2', color: '#00f' },
    ]);
    expect(state.movesRemaining).toBe(3);
  });

  it('wrong answer on normal move decrements movesRemaining by 1', () => {
    const state = createGame([
      { name: 'P1', color: '#f00' },
      { name: 'P2', color: '#00f' },
    ]);
    const pegId = state.players[0].pegIds[0];
    selectPeg(state, 0, pegId);
    const questionsDb = createQuestionsDb();
    const moves = getValidMoves(state, pegId);
    const target = moves[0];

    planTurnQuestions(state, pegId, target.r, target.c, questionsDb);
    const qId = state.pendingTurn.questionIds[0];
    const wrongIdx = (questionsDb._byId[qId].a + 1) % 4;

    applyTurn(state, 0, {
      pegId,
      targetR: target.r,
      targetC: target.c,
      answers: [{ questionId: qId, answerIdx: wrongIdx }],
    }, questionsDb);

    expect(state.movesRemaining).toBe(2);
    expect(state.currentPlayerIdx).toBe(0);
  });

  it('player can select any peg during their turn', () => {
    const state = createGame([
      { name: 'P1', color: '#f00' },
      { name: 'P2', color: '#00f' },
    ]);
    const result0 = selectPeg(state, 0, state.players[0].pegIds[0]);
    expect(result0.ok).toBe(true);
    const result1 = selectPeg(state, 0, state.players[0].pegIds[1]);
    expect(result1.ok).toBe(true);
    const result2 = selectPeg(state, 0, state.players[0].pegIds[2]);
    expect(result2.ok).toBe(true);
  });

  it('turn advances after all 3 move tokens spent via wrong answers', () => {
    const state = createGame([
      { name: 'P1', color: '#f00' },
      { name: 'P2', color: '#00f' },
    ]);
    const questionsDb = createQuestionsDb();
    const pegId = state.players[0].pegIds[0];

    for (let i = 0; i < 3; i++) {
      selectPeg(state, 0, pegId);
      const moves = getValidMoves(state, pegId);
      const target = moves[0];
      planTurnQuestions(state, pegId, target.r, target.c, questionsDb);
      const qId = state.pendingTurn.questionIds[0];
      const wrongIdx = (questionsDb._byId[qId].a + 1) % 4;
      applyTurn(state, 0, {
        pegId,
        targetR: target.r,
        targetC: target.c,
        answers: [{ questionId: qId, answerIdx: wrongIdx }],
      }, questionsDb);
      if (state.currentPlayerIdx !== 0) {break;}
    }

    expect(state.currentPlayerIdx).toBe(1);
  });
});
