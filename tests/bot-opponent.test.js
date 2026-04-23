import { describe, it, expect } from 'vitest';
import {
  createGame,
  applyTurn,
  selectPeg,
  planTurnQuestions,
  advancePendingQuestion,
  getValidMoves,
  CATS,
} from '../server/game/engine.ts';

describe('Bot opponent – turn flow and state handling', () => {
  const baseConfig = { boardSize: 4, enabledCats: ['general'] };

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
          a: 0,
          q: 'Test2?',
          opts: ['A', 'B', 'C', 'D'],
          category: cat,
        },
        {
          id: `${cat}_3`,
          a: 0,
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

  function getStartState() {
    return createGame([{ name: 'Player 1' }, { name: 'Player 2' }], baseConfig);
  }

  // Helper: run combat fully (single-answer API), answering correctly or wrongly per round
  function runCombat(state, questionsDb, p1PegId, p2Peg, answers) {
    let lastResult;
    for (let i = 0; i < answers.length; i++) {
      const qId = state.pendingTurn.questionId;
      const answerIdx =
        answers[i] === 'correct' ? questionsDb._byId[qId].a : (questionsDb._byId[qId].a + 1) % 4;

      lastResult = applyTurn(
        state,
        0,
        {
          pegId: p1PegId,
          targetR: p2Peg.row,
          targetC: p2Peg.col,
          answerIdx,
        },
        questionsDb,
      );

      if (!lastResult.combatContinues) {
        break;
      }
      advancePendingQuestion(state, questionsDb);
    }
    return lastResult;
  }

  it('ends the turn without finishing the game when the first answer is wrong', () => {
    const state = getStartState();
    const questionsDb = createQuestionsDb();
    const p1PegId = state.players[0].pegIds[0];
    const p2PegId = state.players[1].pegIds[0];
    const p2Peg = state.pegs[p2PegId];

    // Position P1 adjacent to P2
    state.board[state.pegs[p1PegId].row][state.pegs[p1PegId].col].pegId = null;
    state.pegs[p1PegId].row = p2Peg.row;
    state.pegs[p1PegId].col = p2Peg.col - 1;
    state.board[p2Peg.row][p2Peg.col - 1].pegId = p1PegId;

    selectPeg(state, 0, p1PegId);
    planTurnQuestions(state, p1PegId, p2Peg.row, p2Peg.col, questionsDb);

    const result = runCombat(state, questionsDb, p1PegId, p2Peg, ['wrong']);

    expect(result.gameOver).toBe(false);
    expect(state.winner).toBeNull();
    expect(state.pendingTurn).toBeNull();
  });

  it('ends the game when combat eliminates the opponent on 4x4 board', () => {
    const state = getStartState();
    const questionsDb = createQuestionsDb();
    const p1PegId = state.players[0].pegIds[0];
    const p2PegId = state.players[1].pegIds[0];
    const p2Peg = state.pegs[p2PegId];

    // Position P1 adjacent to P2
    state.board[state.pegs[p1PegId].row][state.pegs[p1PegId].col].pegId = null;
    state.pegs[p1PegId].row = p2Peg.row;
    state.pegs[p1PegId].col = p2Peg.col - 1;
    state.board[p2Peg.row][p2Peg.col - 1].pegId = p1PegId;

    selectPeg(state, 0, p1PegId);
    planTurnQuestions(state, p1PegId, p2Peg.row, p2Peg.col, questionsDb);

    // 3 correct answers eliminate defender (3 HP)
    const result = runCombat(state, questionsDb, p1PegId, p2Peg, ['correct', 'correct', 'correct']);

    // On 4x4 with 1 peg per player, combat that eliminates opponent ends game
    expect(result.gameOver).toBe(true);
    expect(result.winner).toBe(0);
    expect(state.pendingTurn).toBeNull();
  });

  it('switches turn order correctly after spending all 3 move tokens', () => {
    const state = getStartState();
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

    expect(state.pendingTurn).toBeNull();
    expect(state.currentPlayerIdx).toBe(1);
  });

  it('clears pendingTurn after a wrong answer', () => {
    const state = getStartState();
    const questionsDb = createQuestionsDb();
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

    expect(state.pendingTurn).toBeNull();
  });

  it('bot answers correctly and wins using single-answer API', () => {
    const state = getStartState();
    const questionsDb = createQuestionsDb();
    const p1PegId = state.players[0].pegIds[0];
    const p2PegId = state.players[1].pegIds[0];
    const p2Peg = state.pegs[p2PegId];

    // Position P1 adjacent to P2
    state.board[state.pegs[p1PegId].row][state.pegs[p1PegId].col].pegId = null;
    state.pegs[p1PegId].row = p2Peg.row;
    state.pegs[p1PegId].col = p2Peg.col - 1;
    state.board[p2Peg.row][p2Peg.col - 1].pegId = p1PegId;

    selectPeg(state, 0, p1PegId);
    planTurnQuestions(state, p1PegId, p2Peg.row, p2Peg.col, questionsDb);

    // Bot answers all 3 correctly
    const result = runCombat(state, questionsDb, p1PegId, p2Peg, ['correct', 'correct', 'correct']);

    expect(result.gameOver).toBe(true);
    expect(result.winner).toBe(0);
    expect(state.pendingTurn).toBeNull();
  });
});
