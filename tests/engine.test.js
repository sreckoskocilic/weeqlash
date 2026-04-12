import { describe, it, expect } from 'vitest';
import {
  createGame,
  applyTurn,
  selectPeg,
  planTurnQuestions,
  advancePendingQuestion,
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
      {
        id: `${cat}_1`,
        a: 0,
        q: 'Test?',
        opts: ['A', 'B', 'C', 'D'],
        category: cat,
      },
      {
        id: `${cat}_2`,
        a: 1,
        q: 'Test2?',
        opts: ['A', 'B', 'C', 'D'],
        category: cat,
      },
      {
        id: `${cat}_3`,
        a: 2,
        q: 'Test3?',
        opts: ['A', 'B', 'C', 'D'],
        category: cat,
      },
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

// Helper: apply one combat round (single answer), optionally advance to next question
function combatRound(state, playerIdx, p1PegId, p2Peg, answerIdx, questionsDb) {
  return applyTurn(
    state,
    playerIdx,
    {
      pegId: p1PegId,
      targetR: p2Peg.row,
      targetC: p2Peg.col,
      answerIdx,
    },
    questionsDb,
  );
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
      { boardSize: 2 },
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
      { boardSize: 2 },
    );

    const p1PegId = state.players[0].pegIds[0];
    const p2PegId = state.players[1].pegIds[0];

    const p1Peg = state.pegs[p1PegId];
    const p2Peg = state.pegs[p2PegId];

    expect(p1Peg.row).toBe(0);
    expect(p1Peg.col).toBe(0);
    expect(p2Peg.row).toBe(1);
    expect(p2Peg.col).toBe(1);

    const result = selectPeg(state, 0, p1PegId);
    expect(result.ok).toBe(true);
    expect(result.validMoves).toBeDefined();

    const moves = result.validMoves.map((m) => ({
      r: Math.floor(m / 100),
      c: m % 100,
    }));
    expect(moves).toHaveLength(2);
    expect(moves).toContainEqual({ r: 0, c: 1 });
    expect(moves).toContainEqual({ r: 1, c: 0 });
  });

  it('2x2 board: complete turn with combat (3 rounds, all correct)', () => {
    const state = createGame(
      [
        { name: 'P1', color: '#f00' },
        { name: 'P2', color: '#00f' },
      ],
      { boardSize: 2 },
    );

    const p1PegId = state.players[0].pegIds[0];
    const p2PegId = state.players[1].pegIds[0];
    const p2Peg = state.pegs[p2PegId];

    state.pegs[p1PegId].row = p2Peg.row;
    state.pegs[p1PegId].col = p2Peg.col - 1;
    state.board[p2Peg.row][p2Peg.col - 1].pegId = p1PegId;
    state.board[p2Peg.row][p2Peg.col].pegId = p2PegId;

    selectPeg(state, 0, p1PegId);
    const questionsDb = createQuestionsDb();
    const planResult = planTurnQuestions(
      state,
      p1PegId,
      p2Peg.row,
      p2Peg.col,
      questionsDb,
    );
    expect(planResult.moveType).toBe('combat');

    // Round 1
    let qId = state.pendingTurn.questionId;
    const r1 = combatRound(
      state,
      0,
      p1PegId,
      p2Peg,
      questionsDb._byId[qId].a,
      questionsDb,
    );
    expect(r1.combatContinues).toBe(true);
    advancePendingQuestion(state, questionsDb);

    // Round 2
    qId = state.pendingTurn.questionId;
    const r2 = combatRound(
      state,
      0,
      p1PegId,
      p2Peg,
      questionsDb._byId[qId].a,
      questionsDb,
    );
    expect(r2.combatContinues).toBe(true);
    advancePendingQuestion(state, questionsDb);

    // Round 3
    qId = state.pendingTurn.questionId;
    const r3 = combatRound(
      state,
      0,
      p1PegId,
      p2Peg,
      questionsDb._byId[qId].a,
      questionsDb,
    );
    expect(r3.ok).toBe(true);
    expect(r3.combatContinues).toBe(false);

    expect(state.players[1].pegIds).not.toContain(p2PegId);
    expect(state.board[p2Peg.row][p2Peg.col].pegId).toBe(p1PegId);
    expect(r3.events).toContainEqual({
      type: 'peg_eliminated',
      pegId: p2PegId,
    });
    expect(r3.gameOver).toBe(true);
    expect(r3.winner).toBe(0);
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
    const questionsDb = createQuestionsDb();
    planTurnQuestions(state, pegId, target.r, target.c, questionsDb);

    const qId = state.pendingTurn.questionId;
    const correctIdx = questionsDb._byId[qId].a;

    const turnResult = applyTurn(
      state,
      0,
      {
        pegId,
        targetR: target.r,
        targetC: target.c,
        answerIdx: correctIdx,
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

    const qId = state.pendingTurn.questionId;
    const correctIdx = questionsDb._byId[qId].a;
    const wrongIdx = (correctIdx + 1) % 4;

    const turnResult = applyTurn(
      state,
      0,
      {
        pegId,
        targetR: target.r,
        targetC: target.c,
        answerIdx: wrongIdx,
      },
      questionsDb,
    );

    expect(turnResult.ok).toBe(true);
    expect(state.phase).toBe(PHASE.SELECT_PEG);
  });
});

describe('Engine: Question Selection', () => {
  it('falls back to any available question when the target category is empty', () => {
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
        {
          id: 'science_1',
          a: 0,
          q: 'Fallback?',
          opts: ['A', 'B', 'C', 'D'],
          category: 'science',
        },
      ],
    });
    const pegId = state.players[0].pegIds[0];

    const result = selectPeg(state, 0, pegId);
    expect(result.ok).toBe(true);

    const target = result.validMoves
      .map((m) => ({ r: Math.floor(m / 100), c: m % 100 }))
      .find(({ r, c }) => state.board[r][c].category === 'history');

    expect(target).toBeDefined();

    const planResult = planTurnQuestions(
      state,
      pegId,
      target.r,
      target.c,
      questionsDb,
    );

    expect(planResult.questionId).toBe('science_1');
    expect(state.pendingTurn.questionId).toBe('science_1');
  });

  it('reuses questions instead of returning fewer ids once a category is consumed', () => {
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
        {
          id: 'history_1',
          a: 0,
          q: 'Only one?',
          opts: ['A', 'B', 'C', 'D'],
          category: 'history',
        },
      ],
    });
    const pegId = state.players[0].pegIds[0];

    const result = selectPeg(state, 0, pegId);
    expect(result.ok).toBe(true);

    const target = result.validMoves
      .map((m) => ({ r: Math.floor(m / 100), c: m % 100 }))
      .find(({ r, c }) => state.board[r][c].category === 'history');

    expect(target).toBeDefined();

    const first = planTurnQuestions(
      state,
      pegId,
      target.r,
      target.c,
      questionsDb,
    );
    const second = planTurnQuestions(
      state,
      pegId,
      target.r,
      target.c,
      questionsDb,
    );

    expect(first.questionId).toBe('history_1');
    expect(second.questionId).toBe('history_1');
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
    const planResult = planTurnQuestions(
      state,
      p1PegId,
      p2Peg.row,
      p2Peg.col,
      questionsDb,
    );

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

  it('combat plans questionsTotal = min(movesRemaining, 3)', () => {
    const { planResult, state } = setupCombatState();
    expect(planResult.questionId).toBeTruthy();
    expect(state.pendingTurn.questionsTotal).toBe(Math.min(3, 3)); // movesRemaining=3
  });

  it('attacker misses Q1 — combat ends, defender HP unchanged at 3', () => {
    const { state, p1PegId, p2PegId, p2Peg, questionsDb } = setupCombatState();
    const qId = state.pendingTurn.questionId;
    const wrongA = (questionsDb._byId[qId].a + 1) % 4;

    const result = combatRound(state, 0, p1PegId, p2Peg, wrongA, questionsDb);

    expect(result.ok).toBe(true);
    expect(result.combatContinues).toBe(false);
    expect(state.pegs[p2PegId].hp).toBe(3);
    expect(state.board[p2Peg.row][p2Peg.col].pegId).toBe(p2PegId);
  });

  it('attacker hits Q1+Q2, misses Q3 — defender at 1 HP, survives, turn advances', () => {
    const { state, p1PegId, p2PegId, p2Peg, questionsDb } = setupCombatState();

    // Round 1 correct
    let qId = state.pendingTurn.questionId;
    let r = combatRound(
      state,
      0,
      p1PegId,
      p2Peg,
      questionsDb._byId[qId].a,
      questionsDb,
    );
    expect(r.combatContinues).toBe(true);
    advancePendingQuestion(state, questionsDb);

    // Round 2 correct
    qId = state.pendingTurn.questionId;
    r = combatRound(
      state,
      0,
      p1PegId,
      p2Peg,
      questionsDb._byId[qId].a,
      questionsDb,
    );
    expect(r.combatContinues).toBe(true);
    advancePendingQuestion(state, questionsDb);

    // Round 3 wrong
    qId = state.pendingTurn.questionId;
    r = combatRound(
      state,
      0,
      p1PegId,
      p2Peg,
      (questionsDb._byId[qId].a + 1) % 4,
      questionsDb,
    );

    expect(r.ok).toBe(true);
    expect(r.combatContinues).toBe(false);
    expect(state.pegs[p2PegId].hp).toBe(1);
    expect(state.board[p2Peg.row][p2Peg.col].pegId).toBe(p2PegId);
    expect(state.currentPlayerIdx).toBe(1);
  });

  it('attacker hits Q1+Q2+Q3 — defender eliminated, attacker moves in, turn advances', () => {
    const { state, p1PegId, p2PegId, p2Peg, questionsDb } = setupCombatState();

    // Round 1
    let qId = state.pendingTurn.questionId;
    let r = combatRound(
      state,
      0,
      p1PegId,
      p2Peg,
      questionsDb._byId[qId].a,
      questionsDb,
    );
    expect(r.combatContinues).toBe(true);
    advancePendingQuestion(state, questionsDb);

    // Round 2
    qId = state.pendingTurn.questionId;
    r = combatRound(
      state,
      0,
      p1PegId,
      p2Peg,
      questionsDb._byId[qId].a,
      questionsDb,
    );
    expect(r.combatContinues).toBe(true);
    advancePendingQuestion(state, questionsDb);

    // Round 3
    qId = state.pendingTurn.questionId;
    r = combatRound(
      state,
      0,
      p1PegId,
      p2Peg,
      questionsDb._byId[qId].a,
      questionsDb,
    );

    expect(r.ok).toBe(true);
    expect(r.combatContinues).toBe(false);
    expect(r.events).toContainEqual(
      expect.objectContaining({ type: 'peg_eliminated', pegId: p2PegId }),
    );
    expect(r.events).toContainEqual({
      type: 'peg_moved',
      pegId: p1PegId,
      r: p2Peg.row,
      c: p2Peg.col,
    });
    expect(state.board[p2Peg.row][p2Peg.col].pegId).toBe(p1PegId);
  });

  it('combat_hit events emitted with correct hp values', () => {
    const { state, p1PegId, p2PegId, p2Peg, questionsDb } = setupCombatState();

    // Round 1 correct
    let qId = state.pendingTurn.questionId;
    let r = combatRound(
      state,
      0,
      p1PegId,
      p2Peg,
      questionsDb._byId[qId].a,
      questionsDb,
    );
    expect(r.events).toContainEqual({
      type: 'combat_hit',
      defPegId: p2PegId,
      hp: 2,
    });
    advancePendingQuestion(state, questionsDb);

    // Round 2 correct
    qId = state.pendingTurn.questionId;
    r = combatRound(
      state,
      0,
      p1PegId,
      p2Peg,
      questionsDb._byId[qId].a,
      questionsDb,
    );
    expect(r.events).toContainEqual({
      type: 'combat_hit',
      defPegId: p2PegId,
      hp: 1,
    });
    advancePendingQuestion(state, questionsDb);

    // Round 3 wrong — no hit event
    qId = state.pendingTurn.questionId;
    r = combatRound(
      state,
      0,
      p1PegId,
      p2Peg,
      (questionsDb._byId[qId].a + 1) % 4,
      questionsDb,
    );
    expect(r.events.filter((e) => e.type === 'combat_hit')).toHaveLength(0);
  });

  it('combat with 1 move remaining — questionsTotal = 1, ends after Q1', () => {
    const { state, p1PegId, p2Peg, questionsDb } = setupCombatState();
    state.movesRemaining = 1;
    // Re-plan with movesRemaining=1
    planTurnQuestions(state, p1PegId, p2Peg.row, p2Peg.col, questionsDb);
    expect(state.pendingTurn.questionsTotal).toBe(1);

    const qId = state.pendingTurn.questionId;
    const r = combatRound(
      state,
      0,
      p1PegId,
      p2Peg,
      questionsDb._byId[qId].a,
      questionsDb,
    );
    // After 1 correct answer with questionsTotal=1: combatContinues must be false
    expect(r.combatContinues).toBe(false);
  });

  it('combat with 2 moves remaining — questionsTotal = 2', () => {
    const { state, p1PegId, p2Peg, questionsDb } = setupCombatState();
    state.movesRemaining = 2;
    planTurnQuestions(state, p1PegId, p2Peg.row, p2Peg.col, questionsDb);
    expect(state.pendingTurn.questionsTotal).toBe(2);
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
    const questionsDb = createQuestionsDb();
    selectPeg(state, 0, pegId);
    const moves = getValidMoves(state, pegId);
    const target = moves[0];

    planTurnQuestions(state, pegId, target.r, target.c, questionsDb);
    const qId = state.pendingTurn.questionId;
    const wrongIdx = (questionsDb._byId[qId].a + 1) % 4;

    applyTurn(
      state,
      0,
      {
        pegId,
        targetR: target.r,
        targetC: target.c,
        answerIdx: wrongIdx,
      },
      questionsDb,
    );

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

  it('turn advances after all 3 moves spent via wrong answers', () => {
    const state = createGame([
      { name: 'P1', color: '#f00' },
      { name: 'P2', color: '#00f' },
    ]);
    const questionsDb = createQuestionsDb();

    for (let i = 0; i < 3; i++) {
      const pegId = state.players[0].pegIds[0];
      selectPeg(state, 0, pegId);
      const moves = getValidMoves(state, pegId);
      const target = moves[0];
      planTurnQuestions(state, pegId, target.r, target.c, questionsDb);
      const qId = state.pendingTurn.questionId;
      const wrongIdx = (questionsDb._byId[qId].a + 1) % 4;
      applyTurn(
        state,
        0,
        {
          pegId,
          targetR: target.r,
          targetC: target.c,
          answerIdx: wrongIdx,
        },
        questionsDb,
      );
      if (state.currentPlayerIdx !== 0) {
        break;
      }
    }

    expect(state.currentPlayerIdx).toBe(1);
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

    const p1OrigRow = state.pegs[p1PegId].row;
    const p1OrigCol = state.pegs[p1PegId].col;
    state.board[p1OrigRow][p1OrigCol].pegId = null;
    state.pegs[p1PegId].row = p2Peg.row;
    state.pegs[p1PegId].col = p2Peg.col - 1;
    state.board[p2Peg.row][p2Peg.col - 1].pegId = p1PegId;

    selectPeg(state, 0, p1PegId);
    const questionsDb = createQuestionsDb();
    planTurnQuestions(state, p1PegId, p2Peg.row, p2Peg.col, questionsDb);

    const qId = state.pendingTurn.questionId;
    const wrongA = (questionsDb._byId[qId].a + 1) % 4;

    const result = combatRound(state, 0, p1PegId, p2Peg, wrongA, questionsDb);

    expect(result.ok).toBe(true);
    expect(result.combatContinues).toBe(false);
    expect(state.board[p2Peg.row][p2Peg.col].pegId).toBe(p2PegId);
  });

  it('attacker loses if Q2 wrong (Q1 correct) — turn ends after Q2', () => {
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
    planTurnQuestions(state, p1PegId, p2Peg.row, p2Peg.col, questionsDb);

    // Q1 correct
    let qId = state.pendingTurn.questionId;
    let r = combatRound(
      state,
      0,
      p1PegId,
      p2Peg,
      questionsDb._byId[qId].a,
      questionsDb,
    );
    expect(r.combatContinues).toBe(true);
    advancePendingQuestion(state, questionsDb);

    // Q2 wrong
    qId = state.pendingTurn.questionId;
    r = combatRound(
      state,
      0,
      p1PegId,
      p2Peg,
      (questionsDb._byId[qId].a + 1) % 4,
      questionsDb,
    );

    expect(r.ok).toBe(true);
    expect(r.combatContinues).toBe(false);
    expect(state.board[p2Peg.row][p2Peg.col].pegId).toBe(p2PegId);
    // Turn must have ended
    expect(state.currentPlayerIdx).toBe(1);
  });

  it('attacker wins if all 3 questions correct (defender eliminated at 0 HP)', () => {
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
    planTurnQuestions(state, p1PegId, p2Peg.row, p2Peg.col, questionsDb);

    for (let i = 0; i < 3; i++) {
      const qId = state.pendingTurn.questionId;
      const r = combatRound(
        state,
        0,
        p1PegId,
        p2Peg,
        questionsDb._byId[qId].a,
        questionsDb,
      );
      if (i < 2) {
        expect(r.combatContinues).toBe(true);
        advancePendingQuestion(state, questionsDb);
      } else {
        expect(r.combatContinues).toBe(false);
        expect(state.board[p2Peg.row][p2Peg.col].pegId).toBe(p1PegId);
      }
    }
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
