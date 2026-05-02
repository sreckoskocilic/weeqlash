import { describe, it, expect } from 'vitest';
import {
  createQlasGame,
  calcTimer,
  processAnswer,
  endTurn,
  applyOutcome,
  checkInstantWin,
  checkGameOver,
  PHASE,
} from '../server/game/qlashique.ts';

// ---------------------------------------------------------------------------
// createQlasGame
// ---------------------------------------------------------------------------

describe('createQlasGame', () => {
  it('creates state with 30 HP each', () => {
    const s = createQlasGame();
    expect(s.players[0].hp).toBe(30);
    expect(s.players[1].hp).toBe(30);
  });

  it('accepts custom HP', () => {
    const s = createQlasGame(15);
    expect(s.players[0].hp).toBe(15);
    expect(s.players[1].hp).toBe(15);
  });

  it('starts at turn 1, player 0, score 0, decision phase', () => {
    const s = createQlasGame();
    expect(s.turnNumber).toBe(1);
    expect(s.currentPlayerIdx).toBe(0);
    expect(s.currentScore).toBe(0);
    expect(s.phase).toBe(PHASE.DECISION);
  });
});

// ---------------------------------------------------------------------------
// calcTimer
// ---------------------------------------------------------------------------

describe('calcTimer', () => {
  it('returns 5s for both players in round 1', () => {
    expect(calcTimer(1)).toBe(5);
    expect(calcTimer(2)).toBe(5);
  });

  it('grows +3s per round (pair of turns)', () => {
    expect(calcTimer(3)).toBe(8);
    expect(calcTimer(4)).toBe(8);
    expect(calcTimer(5)).toBe(11);
    expect(calcTimer(6)).toBe(11);
  });

  it('caps at 25s', () => {
    expect(calcTimer(100)).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// processAnswer
// ---------------------------------------------------------------------------

describe('processAnswer', () => {
  function guessingState() {
    const s = createQlasGame();
    s.phase = PHASE.GUESSING;
    return s;
  }

  it('increments score and streak on correct answer', () => {
    const s = guessingState();
    const { correct } = processAnswer(s, 2, 2);
    expect(correct).toBe(true);
    expect(s.currentScore).toBe(1);
    expect(s.correctStreak).toBe(1);
  });

  it('decrements score and resets streak on wrong answer', () => {
    const s = guessingState();
    s.currentScore = 3;
    s.correctStreak = 3;
    const { correct } = processAnswer(s, 1, 0);
    expect(correct).toBe(false);
    expect(s.currentScore).toBe(2);
    expect(s.correctStreak).toBe(0);
  });

  it('returns error outside guessing phase', () => {
    const s = createQlasGame();
    const result = processAnswer(s, 0, 0);
    expect(result.error).toBeTruthy();
  });

  it('treats timer-expiry sentinel (-1) as a wrong answer', () => {
    const s = guessingState();
    s.currentScore = 2;
    s.correctStreak = 2;
    const { correct } = processAnswer(s, -1, 2);
    expect(correct).toBe(false);
    expect(s.currentScore).toBe(1);
    expect(s.correctStreak).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// endTurn
// ---------------------------------------------------------------------------

describe('endTurn', () => {
  function guessingState(score = 0) {
    const s = createQlasGame();
    s.phase = PHASE.GUESSING;
    s.currentScore = score;
    s.correctStreak = Math.max(score, 0);
    return s;
  }

  it('self_damage on negative score — player takes damage', () => {
    const s = guessingState(-3);
    const { outcome } = endTurn(s);
    expect(outcome).toBe('self_damage');
    expect(s.players[0].hp).toBe(27);
  });

  it('nothing on score 0', () => {
    const s = guessingState(0);
    const { outcome } = endTurn(s);
    expect(outcome).toBe('nothing');
    expect(s.players[0].hp).toBe(30);
    expect(s.players[1].hp).toBe(30);
  });

  it('attack on score 1 — opponent takes 1 damage', () => {
    const s = guessingState(1);
    const { outcome } = endTurn(s);
    expect(outcome).toBe('attack');
    expect(s.players[1].hp).toBe(29);
  });

  it('choose on score >= 2', () => {
    const s = guessingState(4);
    const { outcome } = endTurn(s);
    expect(outcome).toBe('choose');
    expect(s.phase).toBe(PHASE.OUTCOME);
    // turn should NOT have advanced yet
    expect(s.currentPlayerIdx).toBe(0);
  });

  it('advances turn after self_damage', () => {
    const s = guessingState(-1);
    endTurn(s);
    expect(s.currentPlayerIdx).toBe(1);
    expect(s.phase).toBe(PHASE.DECISION);
  });

  it('returns error outside guessing phase', () => {
    const s = createQlasGame();
    expect(endTurn(s).error).toBeTruthy();
  });

  it('rejects endTurn in every non-GUESSING phase', () => {
    for (const phase of [PHASE.DECISION, PHASE.OUTCOME, PHASE.GAME_OVER]) {
      const s = createQlasGame();
      s.phase = phase;
      const result = endTurn(s);
      expect(result.error, `phase ${phase} should be rejected`).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// applyOutcome
// ---------------------------------------------------------------------------

describe('applyOutcome', () => {
  function outcomeState(score) {
    const s = createQlasGame();
    s.phase = PHASE.OUTCOME;
    s.currentScore = score;
    return s;
  }

  it('attack deals full score as damage to opponent', () => {
    const s = outcomeState(5);
    applyOutcome(s, 'attack');
    expect(s.players[1].hp).toBe(25);
  });

  it('heal always restores 2 HP to self', () => {
    const s = outcomeState(6);
    s.players[0].hp = 20;
    applyOutcome(s, 'heal');
    expect(s.players[0].hp).toBe(22);
  });

  it('heal with score 2 restores 2 HP', () => {
    const s = outcomeState(2);
    s.players[0].hp = 25;
    applyOutcome(s, 'heal');
    expect(s.players[0].hp).toBe(27);
  });

  it('advances turn after outcome', () => {
    const s = outcomeState(3);
    applyOutcome(s, 'attack');
    expect(s.currentPlayerIdx).toBe(1);
    expect(s.phase).toBe(PHASE.DECISION);
  });

  it('returns error outside outcome phase', () => {
    const s = createQlasGame();
    expect(applyOutcome(s, 'attack').error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// checkInstantWin
// ---------------------------------------------------------------------------

describe('checkInstantWin', () => {
  it('returns true when score >= 10 with no wrong answers', () => {
    const s = createQlasGame();
    s.phase = PHASE.GUESSING;
    s.currentScore = 10;
    s.correctStreak = 10;
    expect(checkInstantWin(s)).toBe(true);
  });

  it('returns false when score >= 10 but has wrong answers', () => {
    const s = createQlasGame();
    s.phase = PHASE.GUESSING;
    s.currentScore = 10;
    s.correctStreak = 8; // had a wrong answer somewhere
    expect(checkInstantWin(s)).toBe(false);
  });

  it('returns false when score < 10 even with no wrong answers', () => {
    const s = createQlasGame();
    s.phase = PHASE.GUESSING;
    s.currentScore = 9;
    s.correctStreak = 9;
    expect(checkInstantWin(s)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkGameOver
// ---------------------------------------------------------------------------

describe('checkGameOver', () => {
  it('returns -1 when both players have HP', () => {
    const s = createQlasGame();
    expect(checkGameOver(s, 0)).toBe(-1);
  });

  it('returns 1 when player 0 reaches 0 HP', () => {
    const s = createQlasGame();
    s.players[0].hp = 0;
    expect(checkGameOver(s, 0)).toBe(1);
  });

  it('returns 0 when player 1 reaches 0 HP', () => {
    const s = createQlasGame();
    s.players[1].hp = 0;
    expect(checkGameOver(s, 0)).toBe(0);
  });

  it('returns opponent as winner when both die simultaneously (self-damage edge case)', () => {
    const s = createQlasGame();
    s.players[0].hp = 0;
    s.players[1].hp = 0;
    expect(checkGameOver(s, 0)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Full turn integration
// ---------------------------------------------------------------------------

describe('full turn flow', () => {
  it('complete turn: 3 correct -> choose -> attack -> advances turn', () => {
    const s = createQlasGame();
    s.phase = PHASE.GUESSING;

    processAnswer(s, 0, 0); // correct
    processAnswer(s, 0, 0); // correct
    processAnswer(s, 0, 0); // correct
    expect(s.currentScore).toBe(3);

    const { outcome } = endTurn(s);
    expect(outcome).toBe('choose');

    applyOutcome(s, 'attack');
    expect(s.players[1].hp).toBe(27);
    expect(s.currentPlayerIdx).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe('edge cases: instant win and self-destruct', () => {
  it('instant win triggers at exactly 10 correct', () => {
    const s = createQlasGame();
    s.phase = PHASE.GUESSING;
    s.currentScore = 10;
    s.correctStreak = 10;
    expect(checkInstantWin(s)).toBe(true);
  });

  it('instant win does not trigger with wrong answers', () => {
    const s = createQlasGame();
    s.phase = PHASE.GUESSING;
    s.currentScore = 10;
    s.correctStreak = 9; // One wrong answer
    expect(checkInstantWin(s)).toBe(false);
  });

  it('self-destruct on negative score', () => {
    const s = createQlasGame();
    s.phase = PHASE.GUESSING;
    s.currentScore = -5;
    const { outcome } = endTurn(s);
    expect(outcome).toBe('self_damage');
    expect(s.players[0].hp).toBe(25); // 30 + (-5)
  });
});

describe('edge cases: outcome panel behavior', () => {
  it('outcome panel not shown for score 0 or 1', () => {
    // Score 0 -> nothing
    const s0 = createQlasGame();
    s0.phase = PHASE.GUESSING;
    s0.currentScore = 0;
    const { outcome: outcome0 } = endTurn(s0);
    expect(outcome0).toBe('nothing');

    // Score 1 -> attack
    const s1 = createQlasGame();
    s1.phase = PHASE.GUESSING;
    s1.currentScore = 1;
    const { outcome: outcome1 } = endTurn(s1);
    expect(outcome1).toBe('attack');
  });

  it('outcome panel shown for score >= 2', () => {
    const s = createQlasGame();
    s.phase = PHASE.GUESSING;
    s.currentScore = 2;
    const { outcome } = endTurn(s);
    expect(outcome).toBe('choose');
    expect(s.phase).toBe(PHASE.OUTCOME);
  });
});

describe('edge cases: simultaneous death scenarios', () => {
  it('both players die from attack - player who attacked loses', () => {
    const s = createQlasGame();
    s.phase = PHASE.GUESSING;
    s.currentScore = 2; // Will allow attack choice (score >= 2)
    s.players[0].hp = 0; // Attacker already at 0 HP
    s.players[1].hp = 2; // Defender at 2 HP

    const { outcome } = endTurn(s);
    expect(outcome).toBe('choose');
    expect(s.phase).toBe(PHASE.OUTCOME);

    const result = applyOutcome(s, 'attack');
    expect(s.players[0].hp).toBe(0);
    expect(s.players[1].hp).toBe(0);

    const winner = checkGameOver(s, result.actingPlayerIdx);
    expect(winner).toBe(1);
  });

  it('both players die from self-damage - current player loses', () => {
    const s = createQlasGame();
    s.phase = PHASE.GUESSING;
    s.currentScore = -5; // Self damage
    s.players[0].hp = 5; // Will die from self damage
    s.players[1].hp = 5; // Opponent also at 5 HP

    const { outcome, actingPlayerIdx } = endTurn(s);
    expect(outcome).toBe('self_damage');
    expect(actingPlayerIdx).toBe(0);

    expect(s.players[0].hp).toBe(0);
    expect(s.players[1].hp).toBe(5);
    expect(s.currentPlayerIdx).toBe(1);

    s.players[1].hp = 0;

    const winner = checkGameOver(s, actingPlayerIdx);
    expect(winner).toBe(1);
  });
});

describe('edge cases: invalid state transitions', () => {
  it('cannot process answer outside guessing phase', () => {
    const s = createQlasGame();
    s.phase = PHASE.DECISION;
    expect(processAnswer(s, 0, 0).error).toBeTruthy();
  });

  it('cannot end turn outside guessing phase', () => {
    const s = createQlasGame();
    s.phase = PHASE.OUTCOME;
    expect(endTurn(s).error).toBeTruthy();
  });

  it('cannot apply outcome outside outcome phase', () => {
    const s = createQlasGame();
    s.phase = PHASE.GUESSING;
    expect(applyOutcome(s, 'attack').error).toBeTruthy();
  });
});

describe('edge cases: score to outcome mapping', () => {
  it('score -1 maps to self_damage', () => {
    const s = createQlasGame();
    s.phase = PHASE.GUESSING;
    s.currentScore = -1;
    const { outcome } = endTurn(s);
    expect(outcome).toBe('self_damage');
  });

  it('score 0 maps to nothing', () => {
    const s = createQlasGame();
    s.phase = PHASE.GUESSING;
    s.currentScore = 0;
    const { outcome } = endTurn(s);
    expect(outcome).toBe('nothing');
  });

  it('score 1 maps to attack', () => {
    const s = createQlasGame();
    s.phase = PHASE.GUESSING;
    s.currentScore = 1;
    const { outcome } = endTurn(s);
    expect(outcome).toBe('attack');
  });

  it('score 2 maps to choose', () => {
    const s = createQlasGame();
    s.phase = PHASE.GUESSING;
    s.currentScore = 2;
    const { outcome } = endTurn(s);
    expect(outcome).toBe('choose');
  });

  it('score 10 maps to choose', () => {
    const s = createQlasGame();
    s.phase = PHASE.GUESSING;
    s.currentScore = 10;
    const { outcome } = endTurn(s);
    expect(outcome).toBe('choose');
  });
});

describe('edge cases: heal calculation', () => {
  it('heal always gives flat 2 HP regardless of score', () => {
    for (const score of [2, 3, 4, 5, 10]) {
      const s = createQlasGame();
      s.phase = PHASE.OUTCOME;
      s.currentScore = score;
      s.players[0].hp = 20;
      applyOutcome(s, 'heal');
      expect(s.players[0].hp).toBe(22);
    }
  });
});

describe('edge cases: attack damage calculation', () => {
  it('attack with score 2 does 2 damage', () => {
    const s = createQlasGame();
    s.phase = PHASE.OUTCOME;
    s.currentScore = 2;
    s.players[1].hp = 20;
    applyOutcome(s, 'attack');
    expect(s.players[1].hp).toBe(18); // 20 - 2
  });

  it('attack with score 5 does 5 damage', () => {
    const s = createQlasGame();
    s.phase = PHASE.OUTCOME;
    s.currentScore = 5;
    s.players[1].hp = 20;
    applyOutcome(s, 'attack');
    expect(s.players[1].hp).toBe(15); // 20 - 5
  });

  it('attack with score 10 does 10 damage', () => {
    const s = createQlasGame();
    s.phase = PHASE.OUTCOME;
    s.currentScore = 10;
    s.players[1].hp = 20;
    applyOutcome(s, 'attack');
    expect(s.players[1].hp).toBe(10); // 20 - 10
  });
});
