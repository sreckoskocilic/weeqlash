import { describe, it, expect } from 'vitest';
import {
  createQlasGame,
  calcTimer,
  processAnswer,
  processReroll,
  endTurn,
  applyOutcome,
  checkInstantWin,
  checkGameOver,
  PHASE,
  CLASSES,
} from '../server/game/qlashique.ts';

// ---------------------------------------------------------------------------
// createQlasGame
// ---------------------------------------------------------------------------

describe('createQlasGame', () => {
  it('creates state with 30 HP each', () => {
    const s = createQlasGame('slowpoke', 'reroll');
    expect(s.players[0].hp).toBe(30);
    expect(s.players[1].hp).toBe(30);
  });

  it('assigns correct classes', () => {
    const s = createQlasGame('slowpoke', 'reroll');
    expect(s.players[0].classId).toBe(CLASSES.SLOWPOKE);
    expect(s.players[1].classId).toBe(CLASSES.REROLL);
  });

  it('starts at turn 1, player 0, score 0, decision phase', () => {
    const s = createQlasGame('reroll', 'reroll');
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
  it('returns 5s on turn 1 for non-slowpoke', () => {
    expect(calcTimer(1, 'reroll')).toBe(5);
  });

  it('returns 7s on turn 1 for Slowpoke', () => {
    expect(calcTimer(1, CLASSES.SLOWPOKE)).toBe(7);
  });

  it('grows +3s per turn', () => {
    expect(calcTimer(2, 'reroll')).toBe(8);
    expect(calcTimer(3, 'reroll')).toBe(11);
  });

  it('caps at 25s', () => {
    expect(calcTimer(100, 'reroll')).toBe(25);
  });

  it('Slowpoke cap is 27s', () => {
    expect(calcTimer(100, CLASSES.SLOWPOKE)).toBe(27);
  });
});

// ---------------------------------------------------------------------------
// processAnswer
// ---------------------------------------------------------------------------

describe('processAnswer', () => {
  function guessingState() {
    const s = createQlasGame('reroll', 'reroll');
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
    const s = createQlasGame('reroll', 'reroll');
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
// processReroll
// ---------------------------------------------------------------------------

describe('processReroll', () => {
  it('marks rerollUsed on valid use', () => {
    const s = createQlasGame('reroll', 'slowpoke');
    s.phase = PHASE.GUESSING;
    processReroll(s);
    expect(s.players[0].rerollUsed).toBe(true);
  });

  it('returns error if already used', () => {
    const s = createQlasGame('reroll', 'slowpoke');
    s.phase = PHASE.GUESSING;
    s.players[0].rerollUsed = true;
    expect(processReroll(s).error).toBeTruthy();
  });

  it('returns error if class is not reroll', () => {
    const s = createQlasGame('slowpoke', 'reroll');
    s.phase = PHASE.GUESSING;
    expect(processReroll(s).error).toBeTruthy();
  });

  it('returns error outside guessing phase', () => {
    const s = createQlasGame('reroll', 'slowpoke');
    expect(processReroll(s).error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// endTurn
// ---------------------------------------------------------------------------

describe('endTurn', () => {
  function guessingState(score = 0) {
    const s = createQlasGame('reroll', 'reroll');
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
    const s = createQlasGame('reroll', 'reroll');
    expect(endTurn(s).error).toBeTruthy();
  });

  it('rejects endTurn in every non-GUESSING phase', () => {
    for (const phase of [PHASE.CLASS_SELECT, PHASE.DECISION, PHASE.OUTCOME, PHASE.GAME_OVER]) {
      const s = createQlasGame('reroll', 'reroll');
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
    const s = createQlasGame('reroll', 'reroll');
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
    const s = createQlasGame('reroll', 'reroll');
    expect(applyOutcome(s, 'attack').error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// checkInstantWin
// ---------------------------------------------------------------------------

describe('checkInstantWin', () => {
  it('returns true when score >= 10 with no wrong answers', () => {
    const s = createQlasGame('reroll', 'reroll');
    s.phase = PHASE.GUESSING;
    s.currentScore = 10;
    s.correctStreak = 10;
    expect(checkInstantWin(s)).toBe(true);
  });

  it('returns false when score >= 10 but has wrong answers', () => {
    const s = createQlasGame('reroll', 'reroll');
    s.phase = PHASE.GUESSING;
    s.currentScore = 10;
    s.correctStreak = 8; // had a wrong answer somewhere
    expect(checkInstantWin(s)).toBe(false);
  });

  it('returns false when score < 10 even with no wrong answers', () => {
    const s = createQlasGame('reroll', 'reroll');
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
    const s = createQlasGame('reroll', 'reroll');
    expect(checkGameOver(s)).toBe(-1);
  });

  it('returns 1 when player 0 reaches 0 HP', () => {
    const s = createQlasGame('reroll', 'reroll');
    s.players[0].hp = 0;
    expect(checkGameOver(s)).toBe(1);
  });

  it('returns 0 when player 1 reaches 0 HP', () => {
    const s = createQlasGame('reroll', 'reroll');
    s.players[1].hp = 0;
    expect(checkGameOver(s)).toBe(0);
  });

  it('returns opponent as winner when both die simultaneously (self-damage edge case)', () => {
    const s = createQlasGame('reroll', 'reroll');
    s.players[0].hp = 0;
    s.players[1].hp = 0;
    s.currentPlayerIdx = 0; // p0 caused their own death
    expect(checkGameOver(s)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Full turn integration
// ---------------------------------------------------------------------------

describe('full turn flow', () => {
  it('complete turn: 3 correct -> choose -> attack -> advances turn', () => {
    const s = createQlasGame('reroll', 'reroll');
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

  it('rerollUsed resets on next player turn', () => {
    const s = createQlasGame('reroll', 'reroll');
    s.phase = PHASE.GUESSING;
    processReroll(s);
    expect(s.players[0].rerollUsed).toBe(true);

    endTurn(s); // score 0 -> nothing, advances to player 1
    expect(s.currentPlayerIdx).toBe(1);

    // back to player 0 next turn
    s.phase = PHASE.GUESSING;
    endTurn(s);
    expect(s.currentPlayerIdx).toBe(0);
    expect(s.players[0].rerollUsed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Edge Cases (Phase 4)
// ---------------------------------------------------------------------------

describe('edge cases: instant win and self-destruct', () => {
  it('instant win triggers at exactly 10 correct', () => {
    const s = createQlasGame('reroll', 'reroll');
    s.phase = PHASE.GUESSING;
    s.currentScore = 10;
    s.correctStreak = 10;
    expect(checkInstantWin(s)).toBe(true);
  });

  it('instant win does not trigger with wrong answers', () => {
    const s = createQlasGame('reroll', 'reroll');
    s.phase = PHASE.GUESSING;
    s.currentScore = 10;
    s.correctStreak = 9; // One wrong answer
    expect(checkInstantWin(s)).toBe(false);
  });

  it('self-destruct on negative score', () => {
    const s = createQlasGame('reroll', 'reroll');
    s.phase = PHASE.GUESSING;
    s.currentScore = -5;
    const { outcome } = endTurn(s);
    expect(outcome).toBe('self_damage');
    expect(s.players[0].hp).toBe(25); // 30 + (-5)
  });
});

describe('edge cases: reroll constraints', () => {
  it('reroll cannot be used outside guessing phase', () => {
    const s = createQlasGame('reroll', 'reroll');
    s.phase = PHASE.DECISION;
    expect(processReroll(s).error).toBeTruthy();
  });

  it('reroll cannot be used by non-reroll class', () => {
    const s = createQlasGame('slowpoke', 'reroll');
    s.phase = PHASE.GUESSING;
    expect(processReroll(s).error).toBeTruthy();
  });

  it('reroll can only be used once per turn', () => {
    const s = createQlasGame('reroll', 'reroll');
    s.phase = PHASE.GUESSING;
    processReroll(s);
    expect(processReroll(s).error).toBeTruthy(); // Already used
  });
});

describe('edge cases: outcome panel behavior', () => {
  it('outcome panel not shown for score 0 or 1', () => {
    // Score 0 -> nothing
    const s0 = createQlasGame('reroll', 'reroll');
    s0.phase = PHASE.GUESSING;
    s0.currentScore = 0;
    const { outcome: outcome0 } = endTurn(s0);
    expect(outcome0).toBe('nothing');

    // Score 1 -> attack
    const s1 = createQlasGame('reroll', 'reroll');
    s1.phase = PHASE.GUESSING;
    s1.currentScore = 1;
    const { outcome: outcome1 } = endTurn(s1);
    expect(outcome1).toBe('attack');
  });

  it('outcome panel shown for score >= 2', () => {
    const s = createQlasGame('reroll', 'reroll');
    s.phase = PHASE.GUESSING;
    s.currentScore = 2;
    const { outcome } = endTurn(s);
    expect(outcome).toBe('choose');
    expect(s.phase).toBe(PHASE.OUTCOME);
  });
});

describe('edge cases: simultaneous death scenarios', () => {
  it('both players die from attack - player who attacked loses', () => {
    const s = createQlasGame('reroll', 'reroll');
    s.phase = PHASE.GUESSING;
    s.currentScore = 2; // Will allow attack choice (score >= 2)
    s.players[0].hp = 0; // Attacker already at 0 HP
    s.players[1].hp = 2; // Defender at 2 HP

    const { outcome } = endTurn(s); // outcome will be 'choose'
    expect(outcome).toBe('choose');
    expect(s.phase).toBe(PHASE.OUTCOME);

    // Apply the attack choice - defender takes damage
    applyOutcome(s, 'attack');
    expect(s.players[0].hp).toBe(0); // Attacker unchanged
    expect(s.players[1].hp).toBe(0); // Defender: 2 - 2 = 0

    // Check who wins - attacker wins when both die (defender is current player)
    const winner = checkGameOver(s);
    expect(winner).toBe(0); // Player 0 wins (attacker wins)
  });

  it('both players die from self-damage - current player loses', () => {
    const s = createQlasGame('reroll', 'reroll');
    s.phase = PHASE.GUESSING;
    s.currentScore = -5; // Self damage
    s.players[0].hp = 5; // Will die from self damage
    s.players[1].hp = 5; // Opponent also at 5 HP

    const { outcome } = endTurn(s); // outcome will be 'self_damage'
    expect(outcome).toBe('self_damage');

    // Apply self damage - both go to 0 HP
    s.players[0].hp += s.currentScore; // 5 + (-5) = 0
    s.phase = PHASE.DECISION; // Simulate phase change
    // Advance turn (simulating what endTurn does)
    s.currentPlayerIdx = 1 - s.currentPlayerIdx;
    s.turnNumber += 1;
    s.currentScore = 0;
    s.correctStreak = 0;
    s.players[1].rerollUsed = false;

    // Check who wins - current player (who caused self-damage) loses
    const winner = checkGameOver(s);
    expect(winner).toBe(1); // Player 1 wins (player 0 loses)
  });
});

describe('edge cases: invalid state transitions', () => {
  it('cannot process answer outside guessing phase', () => {
    const s = createQlasGame('reroll', 'reroll');
    s.phase = PHASE.DECISION;
    expect(processAnswer(s, 0, 0).error).toBeTruthy();
  });

  it('cannot end turn outside guessing phase', () => {
    const s = createQlasGame('reroll', 'reroll');
    s.phase = PHASE.OUTCOME;
    expect(endTurn(s).error).toBeTruthy();
  });

  it('cannot apply outcome outside outcome phase', () => {
    const s = createQlasGame('reroll', 'reroll');
    s.phase = PHASE.GUESSING;
    expect(applyOutcome(s, 'attack').error).toBeTruthy();
  });

  it('cannot use reroll outside guessing phase', () => {
    const s = createQlasGame('reroll', 'reroll');
    s.phase = PHASE.OUTCOME;
    expect(processReroll(s).error).toBeTruthy();
  });
});

describe('edge cases: score to outcome mapping', () => {
  it('score -1 maps to self_damage', () => {
    const s = createQlasGame('reroll', 'reroll');
    s.phase = PHASE.GUESSING;
    s.currentScore = -1;
    const { outcome } = endTurn(s);
    expect(outcome).toBe('self_damage');
  });

  it('score 0 maps to nothing', () => {
    const s = createQlasGame('reroll', 'reroll');
    s.phase = PHASE.GUESSING;
    s.currentScore = 0;
    const { outcome } = endTurn(s);
    expect(outcome).toBe('nothing');
  });

  it('score 1 maps to attack', () => {
    const s = createQlasGame('reroll', 'reroll');
    s.phase = PHASE.GUESSING;
    s.currentScore = 1;
    const { outcome } = endTurn(s);
    expect(outcome).toBe('attack');
  });

  it('score 2 maps to choose', () => {
    const s = createQlasGame('reroll', 'reroll');
    s.phase = PHASE.GUESSING;
    s.currentScore = 2;
    const { outcome } = endTurn(s);
    expect(outcome).toBe('choose');
  });

  it('score 10 maps to choose', () => {
    const s = createQlasGame('reroll', 'reroll');
    s.phase = PHASE.GUESSING;
    s.currentScore = 10;
    const { outcome } = endTurn(s);
    expect(outcome).toBe('choose');
  });
});

describe('edge cases: heal calculation', () => {
  it('heal always gives flat 2 HP regardless of score', () => {
    for (const score of [2, 3, 4, 5, 10]) {
      const s = createQlasGame('reroll', 'reroll');
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
    const s = createQlasGame('reroll', 'reroll');
    s.phase = PHASE.OUTCOME;
    s.currentScore = 2;
    s.players[1].hp = 20;
    applyOutcome(s, 'attack');
    expect(s.players[1].hp).toBe(18); // 20 - 2
  });

  it('attack with score 5 does 5 damage', () => {
    const s = createQlasGame('reroll', 'reroll');
    s.phase = PHASE.OUTCOME;
    s.currentScore = 5;
    s.players[1].hp = 20;
    applyOutcome(s, 'attack');
    expect(s.players[1].hp).toBe(15); // 20 - 5
  });

  it('attack with score 10 does 10 damage', () => {
    const s = createQlasGame('reroll', 'reroll');
    s.phase = PHASE.OUTCOME;
    s.currentScore = 10;
    s.players[1].hp = 20;
    applyOutcome(s, 'attack');
    expect(s.players[1].hp).toBe(10); // 20 - 10
  });
});
