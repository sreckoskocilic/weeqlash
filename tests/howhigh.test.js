import { describe, it, expect } from 'vitest';
import {
  createSession,
  processAnswer,
  processTimeout,
  acceptDice,
  declineDice,
  acceptGoWild,
  declineGoWild,
  scorePicks,
  POINTS,
  BASE_TIMER_MS,
  GOWILD_TIMER_MS,
  BASE_Q_COUNT,
  GOWILD_Q_COUNT,
  DICE_AFTER_Q,
  GOWILD_AFTER_Q,
  OPTIONS_PER_Q,
} from '../server/game/howhigh.ts';

const makeIds = (n = BASE_Q_COUNT) => Array.from({ length: n }, (_, i) => `q${i}`);
const extraIds = () => ['qX0', 'qX1'];
const dice = (d1 = 3, d2 = 4) => ({ die1: d1, die2: d2 });

function answerN(state, n, correctIdx, optionIdx) {
  for (let i = 0; i < n; i++) {
    const res = processAnswer(state, optionIdx ?? correctIdx, correctIdx);
    if ('error' in res) {
      throw new Error(res.error);
    }
    state = res.state;
  }
  return state;
}

describe('HowHigh: constants', () => {
  it('exports expected values', () => {
    expect(POINTS.CORRECT).toBe(2);
    expect(POINTS.WRONG).toBe(-2);
    expect(BASE_TIMER_MS).toBe(13000);
    expect(GOWILD_TIMER_MS).toBe(10000);
    expect(BASE_Q_COUNT).toBe(10);
    expect(GOWILD_Q_COUNT).toBe(12);
    expect(DICE_AFTER_Q).toBe(3);
    expect(GOWILD_AFTER_Q).toBe(6);
    expect(OPTIONS_PER_Q).toBe(4);
  });
});

describe('HowHigh: createSession', () => {
  it('returns correct initial state', () => {
    const s = createSession(makeIds(), dice());
    expect(s.questionIds).toHaveLength(BASE_Q_COUNT);
    expect(s.currentIdx).toBe(0);
    expect(s.score).toBe(0);
    expect(s.results).toEqual([]);
    expect(s.phase).toBe('answering');
    expect(s.dice).toEqual({ die1: 3, die2: 4, accepted: null });
    expect(s.goWildAccepted).toBeNull();
    expect(s.totalQuestions).toBe(BASE_Q_COUNT);
    expect(s.timerMs).toBe(BASE_TIMER_MS);
    expect(s.finished).toBe(false);
  });

  it('copies the question ids array', () => {
    const ids = makeIds();
    const s = createSession(ids, dice());
    ids[0] = 'mutated';
    expect(s.questionIds[0]).toBe('q0');
  });

  it('throws on wrong question count', () => {
    expect(() => createSession(['q0'], dice())).toThrow();
    expect(() => createSession(makeIds(15), dice())).toThrow();
  });

  it('throws on invalid dice', () => {
    expect(() => createSession(makeIds(), { die1: 0, die2: 3 })).toThrow();
    expect(() => createSession(makeIds(), { die1: 7, die2: 3 })).toThrow();
  });
});

describe('HowHigh: processAnswer', () => {
  it('scores correct +2', () => {
    const s = createSession(makeIds(), dice());
    const res = processAnswer(s, 1, 1);
    expect('error' in res).toBe(false);
    if ('error' in res) {
      return;
    }
    expect(res.correct).toBe(true);
    expect(res.state.score).toBe(2);
    expect(res.state.results).toEqual(['correct']);
    expect(res.state.currentIdx).toBe(1);
  });

  it('scores wrong -2', () => {
    const s = createSession(makeIds(), dice());
    const res = processAnswer(s, 0, 1);
    if ('error' in res) {
      return;
    }
    expect(res.correct).toBe(false);
    expect(res.state.score).toBe(-2);
    expect(res.state.results).toEqual(['wrong']);
  });

  it('errors when finished', () => {
    let s = createSession(makeIds(), dice());
    s = answerN(s, DICE_AFTER_Q, 1, 1);
    declineDice(s);
    s = answerN(s, GOWILD_AFTER_Q - DICE_AFTER_Q, 1, 1);
    declineGoWild(s);
    s = answerN(s, BASE_Q_COUNT - GOWILD_AFTER_Q, 1, 1);
    expect(s.finished).toBe(true);
    const res = processAnswer(s, 1, 1);
    expect('error' in res).toBe(true);
  });

  it('errors when not in answering phase', () => {
    let s = createSession(makeIds(), dice());
    s = answerN(s, DICE_AFTER_Q, 1, 1);
    expect(s.phase).toBe('dice_offer');
    const res = processAnswer(s, 1, 1);
    expect('error' in res).toBe(true);
  });
});

describe('HowHigh: processTimeout', () => {
  it('scores as wrong -2', () => {
    const s = createSession(makeIds(), dice());
    const res = processTimeout(s);
    if ('error' in res) {
      return;
    }
    expect(res.state.score).toBe(-2);
    expect(res.state.results).toEqual(['timeout']);
  });
});

describe('HowHigh: dice offer phase', () => {
  function reachDicePhase() {
    let s = createSession(makeIds(), dice(3, 4));
    s = answerN(s, DICE_AFTER_Q, 1, 1);
    expect(s.phase).toBe('dice_offer');
    return s;
  }

  it('triggers dice_offer after Q3', () => {
    let s = createSession(makeIds(), dice());
    for (let i = 0; i < DICE_AFTER_Q; i++) {
      const res = processAnswer(s, 1, 1);
      if ('error' in res) {
        throw new Error(res.error);
      }
      if (i < DICE_AFTER_Q - 1) {
        expect(res.nextPhase).toBeUndefined();
      } else {
        expect(res.nextPhase).toBe('dice_offer');
      }
      s = res.state;
    }
  });

  it('acceptDice sets accepted=true and resumes answering', () => {
    const s = reachDicePhase();
    const res = acceptDice(s);
    if ('error' in res) {
      throw new Error(res.error);
    }
    expect(res.state.dice.accepted).toBe(true);
    expect(res.state.phase).toBe('answering');
  });

  it('declineDice sets accepted=false and resumes answering', () => {
    const s = reachDicePhase();
    const res = declineDice(s);
    if ('error' in res) {
      throw new Error(res.error);
    }
    expect(res.state.dice.accepted).toBe(false);
    expect(res.state.phase).toBe('answering');
  });

  it('errors if not in dice_offer phase', () => {
    const s = createSession(makeIds(), dice());
    expect('error' in acceptDice(s)).toBe(true);
    expect('error' in declineDice(s)).toBe(true);
  });
});

describe('HowHigh: Q4 dice bonus scoring', () => {
  // dice(3,4) = sum 7

  it('correct Q4 with accepted dice: +2 +7 = +9', () => {
    let s = createSession(makeIds(), dice(3, 4));
    s = answerN(s, DICE_AFTER_Q, 1, 1); // Q1-Q3 correct, +6
    acceptDice(s);
    const res = processAnswer(s, 1, 1); // Q4 correct
    if ('error' in res) {
      return;
    }
    // score was 6 (3*2), now +9 → 15
    expect(res.state.score).toBe(6 + 9);
  });

  it('wrong Q4 with accepted dice: -2 - ceil(7/2) = -6', () => {
    let s = createSession(makeIds(), dice(3, 4));
    s = answerN(s, DICE_AFTER_Q, 1, 1); // +6
    acceptDice(s);
    const res = processAnswer(s, 0, 1); // Q4 wrong
    if ('error' in res) {
      return;
    }
    // -2 - ceil(7/2) = -2 - 4 = -6
    expect(res.state.score).toBe(6 - 6);
  });

  it('timeout Q4 with accepted dice: -2 - ceil(7/2) = -6', () => {
    let s = createSession(makeIds(), dice(3, 4));
    s = answerN(s, DICE_AFTER_Q, 1, 1); // +6
    acceptDice(s);
    const res = processTimeout(s); // Q4 timeout
    if ('error' in res) {
      return;
    }
    expect(res.state.score).toBe(6 - 6);
  });

  it('Q4 with declined dice: normal +2/-2', () => {
    let s = createSession(makeIds(), dice(3, 4));
    s = answerN(s, DICE_AFTER_Q, 1, 1); // +6
    declineDice(s);
    const res = processAnswer(s, 1, 1); // Q4 correct, normal
    if ('error' in res) {
      return;
    }
    expect(res.state.score).toBe(6 + 2);
  });

  it('dice bonus with even sum ceil rounds correctly', () => {
    let s = createSession(makeIds(), dice(2, 2)); // sum 4
    s = answerN(s, DICE_AFTER_Q, 1, 1); // +6
    acceptDice(s);
    const res = processAnswer(s, 0, 1); // Q4 wrong
    if ('error' in res) {
      return;
    }
    // -2 - ceil(4/2) = -2 - 2 = -4
    expect(res.state.score).toBe(6 - 4);
  });
});

describe('HowHigh: GoWild offer phase', () => {
  function reachGoWildPhase() {
    let s = createSession(makeIds(), dice());
    s = answerN(s, DICE_AFTER_Q, 1, 1);
    declineDice(s);
    s = answerN(s, GOWILD_AFTER_Q - DICE_AFTER_Q, 1, 1);
    expect(s.phase).toBe('gowild_offer');
    return s;
  }

  it('triggers gowild_offer after Q6', () => {
    const s = reachGoWildPhase();
    expect(s.currentIdx).toBe(GOWILD_AFTER_Q);
    expect(s.phase).toBe('gowild_offer');
  });

  it('acceptGoWild extends to 12 questions and 5s timer', () => {
    const s = reachGoWildPhase();
    const res = acceptGoWild(s, extraIds());
    if ('error' in res) {
      throw new Error(res.error);
    }
    expect(res.state.totalQuestions).toBe(GOWILD_Q_COUNT);
    expect(res.state.timerMs).toBe(GOWILD_TIMER_MS);
    expect(res.state.goWildAccepted).toBe(true);
    expect(res.state.questionIds).toHaveLength(GOWILD_Q_COUNT);
    expect(res.state.phase).toBe('answering');
  });

  it('declineGoWild keeps 10 questions and 13s timer', () => {
    const s = reachGoWildPhase();
    const res = declineGoWild(s);
    if ('error' in res) {
      throw new Error(res.error);
    }
    expect(res.state.totalQuestions).toBe(BASE_Q_COUNT);
    expect(res.state.timerMs).toBe(BASE_TIMER_MS);
    expect(res.state.goWildAccepted).toBe(false);
    expect(res.state.phase).toBe('answering');
  });

  it('errors with wrong extra count', () => {
    const s = reachGoWildPhase();
    const res = acceptGoWild(s, ['only1']);
    expect('error' in res).toBe(true);
  });

  it('errors if not in gowild_offer phase', () => {
    const s = createSession(makeIds(), dice());
    expect('error' in acceptGoWild(s, extraIds())).toBe(true);
    expect('error' in declineGoWild(s)).toBe(true);
  });
});

describe('HowHigh: full run scores', () => {
  it('all correct, no bonuses: 10 * 2 = 20', () => {
    let s = createSession(makeIds(), dice());
    s = answerN(s, DICE_AFTER_Q, 1, 1);
    declineDice(s);
    s = answerN(s, GOWILD_AFTER_Q - DICE_AFTER_Q, 1, 1);
    declineGoWild(s);
    s = answerN(s, BASE_Q_COUNT - GOWILD_AFTER_Q, 1, 1);
    expect(s.finished).toBe(true);
    expect(s.score).toBe(20);
  });

  it('all wrong, no bonuses: 10 * -2 = -20', () => {
    let s = createSession(makeIds(), dice());
    s = answerN(s, DICE_AFTER_Q, 1, 0);
    declineDice(s);
    s = answerN(s, GOWILD_AFTER_Q - DICE_AFTER_Q, 1, 0);
    declineGoWild(s);
    s = answerN(s, BASE_Q_COUNT - GOWILD_AFTER_Q, 1, 0);
    expect(s.finished).toBe(true);
    expect(s.score).toBe(-20);
  });

  it('all correct + dice(6,6) accepted + GoWild: 12*2 + 12 = 36', () => {
    let s = createSession(makeIds(), dice(6, 6));
    s = answerN(s, DICE_AFTER_Q, 1, 1); // +6
    acceptDice(s);
    s = answerN(s, 1, 1, 1); // Q4 correct: +2+12 = +14
    s = answerN(s, GOWILD_AFTER_Q - DICE_AFTER_Q - 1, 1, 1); // Q5-Q6: +4
    acceptGoWild(s, extraIds());
    s = answerN(s, GOWILD_Q_COUNT - GOWILD_AFTER_Q, 1, 1); // Q7-Q12: +12
    expect(s.finished).toBe(true);
    expect(s.score).toBe(6 + 14 + 4 + 12); // 36
  });

  it('all correct + dice(6,6) accepted, no GoWild: 10*2 + 12 = 32', () => {
    let s = createSession(makeIds(), dice(6, 6));
    s = answerN(s, DICE_AFTER_Q, 1, 1); // +6
    acceptDice(s);
    s = answerN(s, 1, 1, 1); // Q4: +14
    s = answerN(s, GOWILD_AFTER_Q - DICE_AFTER_Q - 1, 1, 1); // Q5-Q6: +4
    declineGoWild(s);
    s = answerN(s, BASE_Q_COUNT - GOWILD_AFTER_Q, 1, 1); // Q7-Q10: +8
    expect(s.finished).toBe(true);
    expect(s.score).toBe(6 + 14 + 4 + 8); // 32
  });

  it('finishes at 12 when GoWild accepted', () => {
    let s = createSession(makeIds(), dice());
    s = answerN(s, DICE_AFTER_Q, 1, 1);
    declineDice(s);
    s = answerN(s, GOWILD_AFTER_Q - DICE_AFTER_Q, 1, 1);
    acceptGoWild(s, extraIds());
    s = answerN(s, GOWILD_Q_COUNT - GOWILD_AFTER_Q, 1, 1);
    expect(s.finished).toBe(true);
    expect(s.currentIdx).toBe(GOWILD_Q_COUNT);
  });
});

describe('HowHigh: scorePicks', () => {
  const makeQs = (n) => Array.from({ length: n }, (_, i) => ({ id: `q${i}`, a: 1 }));

  it('all correct no dice: 10*2 = 20', () => {
    const picks = Array(10).fill(1);
    const { score, results } = scorePicks(makeQs(10), picks, { die1: 3, die2: 4, accepted: false });
    expect(score).toBe(20);
    expect(results.every((r) => r === 'correct')).toBe(true);
  });

  it('all null (timeout): 10*-2 = -20', () => {
    const picks = Array(10).fill(null);
    const { score, results } = scorePicks(makeQs(10), picks, { die1: 3, die2: 4, accepted: false });
    expect(score).toBe(-20);
    expect(results.every((r) => r === 'timeout')).toBe(true);
  });

  it('Q4 correct with accepted dice(3,4): +2+7 at idx 3', () => {
    const picks = Array(10).fill(1);
    const { score } = scorePicks(makeQs(10), picks, { die1: 3, die2: 4, accepted: true });
    // 9*2 + (2+7) = 18 + 9 = 27
    expect(score).toBe(27);
  });

  it('Q4 wrong with accepted dice(3,4): -2-4 at idx 3', () => {
    const picks = Array(10).fill(0); // all wrong
    const { score } = scorePicks(makeQs(10), picks, { die1: 3, die2: 4, accepted: true });
    // 9*(-2) + (-2-4) = -18 + -6 = -24
    expect(score).toBe(-24);
  });

  it('12 questions (GoWild)', () => {
    const picks = Array(12).fill(1);
    const { score } = scorePicks(makeQs(12), picks, { die1: 1, die2: 1, accepted: false });
    expect(score).toBe(24);
  });
});
