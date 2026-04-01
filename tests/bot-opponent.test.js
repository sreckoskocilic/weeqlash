import { describe, it, expect } from 'vitest';
import { createGame, applyTurn, botSelectAnswers } from '../server/game/engine.js';

describe('Bot opponent – turn flow and state handling', () => {
  const baseConfig = { boardSize: 2, enabledCats: ['general'] };
  function getStartState() {
    const s = createGame(
      [{ name: 'Player 1' }, { name: 'Player 2' }],
      baseConfig
    );
    s.pendingTurn = null;
    return s;
  }

  const pegId0 = Object.keys(getStartState().pegs)[0];
  const questionsDb = {
    general: [
      { id: 'q1', a: 0 },
      { id: 'q2', a: 0 },
    ],
    _byId: {
      q1: { a: 0 },
      q2: { a: 0 },
    },
  };
  const baseSubmission = {
    pegId: pegId0,
    targetR: 1,
    targetC: 1,
    moveType: 'combat',
    questionIds: ['q1', 'q2'],
  };

  it('ends the turn without finishing the game when the first answer is wrong', () => {
    const wrongSubmission = {
      ...baseSubmission,
      answers: [{ questionId: 'q1', answerIdx: 1 }],
    };

    const { result, state: after } = triggerTurn(
      getStartState(),
      0,
      questionsDb,
      wrongSubmission
    );

    expect(result.gameOver).toBe(false);
    expect(after.winner).toBeNull();
    expect(after.pendingTurn).toBeNull();
  });

  it('ends the game when combat eliminates the opponent on 2x2 board', () => {
    const correctSubmission = {
      ...baseSubmission,
      answers: [
        { questionId: 'q1', answerIdx: 0 },
        { questionId: 'q2', answerIdx: 0 },
      ],
    };

    const { result, state: after } = triggerTurn(
      getStartState(),
      0,
      questionsDb,
      correctSubmission
    );

    // On 2x2 with 1 peg per player, combat that eliminates opponent ends game
    expect(result.gameOver).toBe(true);
    expect(result.winner).toBe(0);
    expect(after.pendingTurn).toBeNull();
  });

  it('switches turn order correctly after a completed turn', () => {
    const normalSubmission = {
      pegId: pegId0,
      targetR: 0,
      targetC: 1,
      moveType: 'normal',
      questionIds: ['q1'],
      answers: [{ questionId: 'q1', answerIdx: 0 }],
    };

    const { state: after } = triggerTurn(
      getStartState(),
      0,
      questionsDb,
      normalSubmission
    );

    expect(after.pendingTurn).toBeNull();
    expect(after.currentPlayerIdx).toBe(1);
  });

  it('clears pendingTurn after a wrong answer', () => {
    const wrongSubmission = {
      ...baseSubmission,
      answers: [{ questionId: 'q1', answerIdx: 1 }],
    };

    const state = getStartState();
    state.pendingTurn = { ...baseSubmission };
    const { state: after } = triggerTurn(
      state,
      0,
      questionsDb,
      wrongSubmission
    );

    expect(after.pendingTurn).toBeNull();
  });

  it('bot can play a turn using botSelectAnswers', () => {
    const botSubmission = {
      ...baseSubmission,
      answers: botSelectAnswers(baseSubmission.questionIds, questionsDb),
    };

    const { result, state: after } = triggerTurn(
      getStartState(),
      0,
      questionsDb,
      botSubmission
    );

    // The bot should have answered correctly and won the game
    expect(result.gameOver).toBe(true);
    expect(result.winner).toBe(0);
    expect(after.pendingTurn).toBeNull();
  });
});

function triggerTurn(state, playerId, questionsDb, submission) {
  state.selectedPegId = submission.pegId;
  state.pendingTurn = {
    pegId: submission.pegId,
    targetR: submission.targetR,
    targetC: submission.targetC,
    moveType: submission.moveType,
    questionIds: submission.questionIds,
  };
  const result = applyTurn(state, playerId, submission, questionsDb);
  return { result, state };
}
