import { describe, it, expect } from 'vitest';
import {
  scorePicks,
  POINTS,
  TIMER_MS,
  QUESTION_COUNT,
  OPTIONS_PER_Q,
} from '../server/game/skipnot.ts';

describe('SkipNoT: constants', () => {
  it('exports the expected scoring and shape constants', () => {
    expect(POINTS.CORRECT).toBe(13);
    expect(POINTS.WRONG).toBe(-7);
    expect(POINTS.SKIP).toBe(0);
    expect(POINTS.TIMEOUT).toBe(0);
    expect(TIMER_MS).toBe(12000);
    expect(QUESTION_COUNT).toBe(20);
    expect(OPTIONS_PER_Q).toBe(4);
  });
});

describe('SkipNoT: scorePicks (server-side re-scoring of submitted picks)', () => {
  // 20 fake questions where the correct answer is index 0 for all.
  const allCorrectAt0 = Array.from({ length: QUESTION_COUNT }, (_, i) => ({
    id: `q${i}`,
    a: 0,
  }));

  it('all correct picks → +260, all results "correct"', () => {
    const picks = Array(QUESTION_COUNT).fill(0);
    const r = scorePicks(allCorrectAt0, picks);
    expect(r.score).toBe(260);
    expect(r.results.every((x) => x === 'correct')).toBe(true);
  });

  it('all wrong picks → -140, all results "wrong"', () => {
    const picks = Array(QUESTION_COUNT).fill(1);
    const r = scorePicks(allCorrectAt0, picks);
    expect(r.score).toBe(-140);
    expect(r.results.every((x) => x === 'wrong')).toBe(true);
  });

  it('all null (skip / timeout) → 0, all results "skip"', () => {
    const picks = Array(QUESTION_COUNT).fill(null);
    const r = scorePicks(allCorrectAt0, picks);
    expect(r.score).toBe(0);
    expect(r.results.every((x) => x === 'skip')).toBe(true);
  });

  it('mixed: 10 correct + 5 wrong + 3 null + 2 wrong-other-index = 95 + extra wrongs', () => {
    const picks = [
      ...Array(10).fill(0), // correct
      ...Array(5).fill(1), // wrong
      ...Array(3).fill(null), // skip
      ...Array(2).fill(2), // wrong (different non-correct index)
    ];
    const r = scorePicks(allCorrectAt0, picks);
    // 10*13 + 5*-7 + 3*0 + 2*-7 = 130 - 35 - 14 = 81
    expect(r.score).toBe(81);
    expect(r.results).toEqual([
      ...Array(10).fill('correct'),
      ...Array(5).fill('wrong'),
      ...Array(3).fill('skip'),
      ...Array(2).fill('wrong'),
    ]);
  });

  it('undefined slots score like null (treated as unanswered)', () => {
    // eslint-disable-next-line no-sparse-arrays
    const picks = [0, 0, , 0, , ...Array(15).fill(0)];
    const r = scorePicks(allCorrectAt0, picks);
    // 18 * +13 + 2 * 0 = 234
    expect(r.score).toBe(234);
  });

  it('honors per-question correct index (not just position 0)', () => {
    const questions = [
      { id: 'q0', a: 2 },
      { id: 'q1', a: 3 },
      { id: 'q2', a: 0 },
    ];
    const r = scorePicks(questions, [2, 3, 0]);
    expect(r.score).toBe(3 * 13);
    expect(r.results).toEqual(['correct', 'correct', 'correct']);
  });
});
