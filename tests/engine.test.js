import { describe, it, expect } from 'vitest';
import {
  createGame,
  applyTurn,
  selectPeg,
  planTurnQuestions,
  checkWinCondition,
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

  it('fails move on wrong answer', () => {
    const state = createGame([
      { name: 'P1', color: '#f00' },
      { name: 'P2', color: '#00f' },
    ]);
    const pegId = state.players[0].pegIds[0];

    const result = selectPeg(state, 0, pegId);
    expect(result.ok).toBe(true);

    const moves = result.validMoves.map((m) => ({
      r: Math.floor(m / 100),
      c: m % 100,
    }));
    const target = moves[0];

    planTurnQuestions(state, pegId, target.r, target.c, createQuestionsDb());

    const turnResult = applyTurn(
      state,
      0,
      {
        pegId,
        targetR: target.r,
        targetC: target.c,
        answers: [
          { questionId: state.pendingTurn.questionIds[0], answerIdx: 1 },
        ],
      },
      createQuestionsDb(),
    );

    expect(turnResult.ok).toBe(true);
    expect(state.phase).toBe(PHASE.SELECT_PEG);
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
    planTurnQuestions(
      state,
      p1PegId,
      p2Peg.row,
      p2Peg.col,
      createQuestionsDb(),
    );

    const result = applyTurn(
      state,
      0,
      {
        pegId: p1PegId,
        targetR: p2Peg.row,
        targetC: p2Peg.col,
        answers: [
          { questionId: state.pendingTurn.questionIds[0], answerIdx: 1 }, // Wrong
          { questionId: state.pendingTurn.questionIds[1], answerIdx: 0 },
        ],
      },
      createQuestionsDb(),
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
    planTurnQuestions(
      state,
      p1PegId,
      p2Peg.row,
      p2Peg.col,
      createQuestionsDb(),
    );

    const result = applyTurn(
      state,
      0,
      {
        pegId: p1PegId,
        targetR: p2Peg.row,
        targetC: p2Peg.col,
        answers: [
          { questionId: state.pendingTurn.questionIds[0], answerIdx: 0 }, // Correct
          { questionId: state.pendingTurn.questionIds[1], answerIdx: 0 }, // Wrong (correct is 1)
        ],
      },
      createQuestionsDb(),
    );

    expect(result.ok).toBe(true);
    expect(state.board[p2Peg.row][p2Peg.col].pegId).toBe(p2PegId);
  });

  it('attacker wins if both Q1 and Q2 correct', () => {
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
    const a1 = questionsDb._byId[q1Id].a;
    const a2 = questionsDb._byId[q2Id].a;

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
