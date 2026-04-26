import { describe, it, expect } from 'vitest';
import {
  createSession,
  processAnswer,
  processSkip,
  processTimeout,
  scorePicks,
  POINTS,
  TIMER_MS,
  QUESTION_COUNT,
  OPTIONS_PER_Q,
} from '../server/game/skipnot.ts';

const makeIds = (n = QUESTION_COUNT) => Array.from({ length: n }, (_, i) => `q${i}`);

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

describe('SkipNoT: createSession', () => {
  it('returns initial state with the supplied question ids', () => {
    const ids = makeIds();
    const s = createSession(ids);
    expect(s.questionIds).toEqual(ids);
    expect(s.currentIdx).toBe(0);
    expect(s.score).toBe(0);
    expect(s.results).toEqual([]);
    expect(s.finished).toBe(false);
  });

  it('copies the input array (mutating caller does not affect state)', () => {
    const ids = makeIds();
    const s = createSession(ids);
    ids[0] = 'mutated';
    expect(s.questionIds[0]).toBe('q0');
  });

  it('throws when given the wrong number of questions', () => {
    expect(() => createSession(makeIds(19))).toThrow();
    expect(() => createSession(makeIds(21))).toThrow();
    expect(() => createSession([])).toThrow();
  });
});

describe('SkipNoT: processAnswer', () => {
  it('correct answer adds +13 and records correct', () => {
    const s = createSession(makeIds());
    const r = processAnswer(s, 2, 2);
    expect('error' in r).toBe(false);
    if ('error' in r) {
      return;
    }
    expect(r.correct).toBe(true);
    expect(r.state.score).toBe(13);
    expect(r.state.currentIdx).toBe(1);
    expect(r.state.results).toEqual(['correct']);
    expect(r.finished).toBe(false);
  });

  it('wrong answer subtracts 7 and records wrong', () => {
    const s = createSession(makeIds());
    const r = processAnswer(s, 0, 3);
    if ('error' in r) {
      throw new Error('unexpected error');
    }
    expect(r.correct).toBe(false);
    expect(r.state.score).toBe(-7);
    expect(r.state.currentIdx).toBe(1);
    expect(r.state.results).toEqual(['wrong']);
  });

  it('rejects answers after the session is finished', () => {
    const s = createSession(makeIds());
    for (let i = 0; i < QUESTION_COUNT; i++) {
      processAnswer(s, 0, 0);
    }
    expect(s.finished).toBe(true);
    const r = processAnswer(s, 0, 0);
    expect('error' in r).toBe(true);
  });
});

describe('SkipNoT: processSkip', () => {
  it('adds 0 and records skip', () => {
    const s = createSession(makeIds());
    const r = processSkip(s);
    if ('error' in r) {
      throw new Error('unexpected error');
    }
    expect(r.state.score).toBe(0);
    expect(r.state.currentIdx).toBe(1);
    expect(r.state.results).toEqual(['skip']);
  });

  it('rejects skips after the session is finished', () => {
    const s = createSession(makeIds());
    for (let i = 0; i < QUESTION_COUNT; i++) {
      processSkip(s);
    }
    expect(s.finished).toBe(true);
    expect('error' in processSkip(s)).toBe(true);
  });
});

describe('SkipNoT: processTimeout', () => {
  it('adds 0 and records timeout', () => {
    const s = createSession(makeIds());
    const r = processTimeout(s);
    if ('error' in r) {
      throw new Error('unexpected error');
    }
    expect(r.state.score).toBe(0);
    expect(r.state.currentIdx).toBe(1);
    expect(r.state.results).toEqual(['timeout']);
  });

  it('rejects timeouts after the session is finished', () => {
    const s = createSession(makeIds());
    for (let i = 0; i < QUESTION_COUNT; i++) {
      processTimeout(s);
    }
    expect(s.finished).toBe(true);
    expect('error' in processTimeout(s)).toBe(true);
  });
});

describe('SkipNoT: full-run score totals', () => {
  it('all correct → +260 (max)', () => {
    const s = createSession(makeIds());
    for (let i = 0; i < QUESTION_COUNT; i++) {
      processAnswer(s, 0, 0);
    }
    expect(s.score).toBe(260);
    expect(s.finished).toBe(true);
    expect(s.results.every((r) => r === 'correct')).toBe(true);
  });

  it('all wrong → -140 (min)', () => {
    const s = createSession(makeIds());
    for (let i = 0; i < QUESTION_COUNT; i++) {
      processAnswer(s, 0, 1);
    }
    expect(s.score).toBe(-140);
  });

  it('all skip → 0', () => {
    const s = createSession(makeIds());
    for (let i = 0; i < QUESTION_COUNT; i++) {
      processSkip(s);
    }
    expect(s.score).toBe(0);
  });

  it('all timeout → 0', () => {
    const s = createSession(makeIds());
    for (let i = 0; i < QUESTION_COUNT; i++) {
      processTimeout(s);
    }
    expect(s.score).toBe(0);
  });

  it('mixed run: 10 correct + 5 wrong + 3 skip + 2 timeout = 95', () => {
    const s = createSession(makeIds());
    for (let i = 0; i < 10; i++) {
      processAnswer(s, 0, 0);
    }
    for (let i = 0; i < 5; i++) {
      processAnswer(s, 0, 1);
    }
    for (let i = 0; i < 3; i++) {
      processSkip(s);
    }
    for (let i = 0; i < 2; i++) {
      processTimeout(s);
    }
    expect(s.score).toBe(10 * 13 + 5 * -7 + 0 + 0);
    expect(s.score).toBe(95);
    expect(s.finished).toBe(true);
    expect(s.results).toEqual([
      ...Array(10).fill('correct'),
      ...Array(5).fill('wrong'),
      ...Array(3).fill('skip'),
      ...Array(2).fill('timeout'),
    ]);
  });
});

describe('SkipNoT: finished flag transitions', () => {
  it('is not finished until the 20th action completes', () => {
    const s = createSession(makeIds());
    for (let i = 0; i < QUESTION_COUNT - 1; i++) {
      const r = processSkip(s);
      if ('error' in r) {
        throw new Error('unexpected error');
      }
      expect(r.finished).toBe(false);
    }
    const last = processSkip(s);
    if ('error' in last) {
      throw new Error('unexpected error');
    }
    expect(last.finished).toBe(true);
    expect(s.currentIdx).toBe(QUESTION_COUNT);
  });

  it('mixing actions across the run all advance currentIdx exactly once', () => {
    const s = createSession(makeIds());
    processAnswer(s, 0, 0);
    processSkip(s);
    processTimeout(s);
    processAnswer(s, 1, 0);
    expect(s.currentIdx).toBe(4);
    expect(s.results).toEqual(['correct', 'skip', 'timeout', 'wrong']);
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
