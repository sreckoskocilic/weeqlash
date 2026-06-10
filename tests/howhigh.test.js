import { describe, it, expect } from 'vitest';
import { scorePicks } from '../server/game/howhigh.ts';

describe('HowHigh: scorePicks', () => {
  const makeQs = (n) => Array.from({ length: n }, (_, i) => ({ id: `q${i}`, a: 1 }));
  const baseOpts = {
    dice: { die1: 3, die2: 4, accepted: false },
    bonusQ3: 'dice',
    bonusQ6: 'gowild',
    donAccepted: false,
    timeCrunchAccepted: false,
  };

  it('all correct no dice: 10*2 = 20', () => {
    const picks = Array(10).fill(1);
    const { score, results } = scorePicks(makeQs(10), picks, baseOpts);
    expect(score).toBe(20);
    expect(results.every((r) => r === 'correct')).toBe(true);
  });

  it('all null (timeout): 10*-2 = -20', () => {
    const picks = Array(10).fill(null);
    const { score, results } = scorePicks(makeQs(10), picks, baseOpts);
    expect(score).toBe(-20);
    expect(results.every((r) => r === 'timeout')).toBe(true);
  });

  it('Q4 correct with accepted dice(3,4): +2+7 at idx 3', () => {
    const picks = Array(10).fill(1);
    const { score } = scorePicks(makeQs(10), picks, {
      ...baseOpts,
      dice: { die1: 3, die2: 4, accepted: true },
    });
    // 9*2 + (2+7) = 18 + 9 = 27
    expect(score).toBe(27);
  });

  it('Q4 wrong with accepted dice(3,4): -2-4 at idx 3', () => {
    const picks = Array(10).fill(0); // all wrong
    const { score } = scorePicks(makeQs(10), picks, {
      ...baseOpts,
      dice: { die1: 3, die2: 4, accepted: true },
    });
    // 9*(-2) + (-2-4) = -18 + -6 = -24
    expect(score).toBe(-24);
  });

  it('12 questions (GoWild)', () => {
    const picks = Array(12).fill(1);
    const { score } = scorePicks(makeQs(12), picks, {
      ...baseOpts,
      dice: { die1: 1, die2: 1, accepted: false },
    });
    expect(score).toBe(24);
  });

  it('Double or Nothing accepted: Q4+Q5 correct = 4+4, rest normal', () => {
    const picks = Array(10).fill(1);
    const { score } = scorePicks(makeQs(10), picks, {
      ...baseOpts,
      bonusQ3: 'double_or_nothing',
      donAccepted: true,
    });
    // Q0-Q2: 3*2=6, Q3-Q4 (DoN): 2*4=8, Q5-Q9: 5*2=10 → 24
    expect(score).toBe(24);
  });

  it('Double or Nothing accepted: Q4+Q5 wrong = -4+-4', () => {
    const picks = Array(10).fill(0);
    const { score } = scorePicks(makeQs(10), picks, {
      ...baseOpts,
      bonusQ3: 'double_or_nothing',
      donAccepted: true,
    });
    // Q0-Q2: 3*-2=-6, Q3-Q4 (DoN): 2*-4=-8, Q5-Q9: 5*-2=-10 → -24
    expect(score).toBe(-24);
  });

  it('Time Crunch accepted: Q7+Q8 correct = 3+3', () => {
    const picks = Array(10).fill(1);
    const { score } = scorePicks(makeQs(10), picks, {
      ...baseOpts,
      bonusQ6: 'time_crunch',
      timeCrunchAccepted: true,
    });
    // Q0-Q5: 6*2=12, Q6-Q7 (TC): 2*3=6, Q8-Q9: 2*2=4 → 22
    expect(score).toBe(22);
  });

  it('Time Crunch accepted: Q7+Q8 wrong = -3+-3', () => {
    const picks = Array(10).fill(0);
    const { score } = scorePicks(makeQs(10), picks, {
      ...baseOpts,
      bonusQ6: 'time_crunch',
      timeCrunchAccepted: true,
    });
    // Q0-Q5: 6*-2=-12, Q6-Q7 (TC): 2*-3=-6, Q8-Q9: 2*-2=-4 → -22
    expect(score).toBe(-22);
  });
});
