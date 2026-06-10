import { describe, it, expect } from 'vitest';
import { scorePick, scorePicks, BASE_POINTS } from '../server/game/mathquiz.ts';
import { generate, generateSet, toPublic, TOPIC_IDS, TOPICS } from '../server/game/mathgen.ts';

describe('mathquiz: scorePick (exact band)', () => {
  const p = { answer: 5, scoring: 'exact', tol: 1e-6, range: 1e-6, points: 10 };

  it('exact hit → full credit', () => {
    const r = scorePick(p, 5);
    expect(r).toMatchObject({ earned: 10, fraction: 1, outcome: 'correct' });
  });
  it('any miss → zero (step function)', () => {
    expect(scorePick(p, 5.5)).toMatchObject({ earned: 0, fraction: 0, outcome: 'wrong' });
    expect(scorePick(p, 4)).toMatchObject({ earned: 0, outcome: 'wrong' });
  });
  it('null / NaN guess → skip, zero', () => {
    expect(scorePick(p, null)).toMatchObject({ earned: 0, outcome: 'skip' });
    expect(scorePick(p, NaN)).toMatchObject({ earned: 0, outcome: 'skip' });
  });
});

describe('mathquiz: scorePick (proximity linear band)', () => {
  const p = { answer: 10, scoring: 'proximity', tol: 0.05, range: 2, points: 10 };

  it('within tol → full credit', () => {
    expect(scorePick(p, 10.04).fraction).toBe(1);
    expect(scorePick(p, 9.96).earned).toBe(10);
  });
  it('beyond range → zero', () => {
    expect(scorePick(p, 12.5)).toMatchObject({ earned: 0, outcome: 'wrong' });
    expect(scorePick(p, 7)).toMatchObject({ earned: 0, outcome: 'wrong' });
  });
  it('midway → partial, linear', () => {
    // d = 1.025 → halfway between tol(0.05) and range(2)
    const r = scorePick(p, 11.025);
    expect(r.outcome).toBe('partial');
    expect(r.fraction).toBeCloseTo(0.5, 5);
    expect(r.earned).toBe(5);
  });
  it('symmetric below the answer', () => {
    expect(scorePick(p, 8.975).fraction).toBeCloseTo(0.5, 5);
  });
});

describe('mathquiz: scorePicks', () => {
  it('sums earned and reports per-question outcomes', () => {
    const probs = [
      { answer: 5, scoring: 'exact', tol: 1e-6, range: 1e-6, points: 10 },
      { answer: 10, scoring: 'proximity', tol: 0.05, range: 2, points: 10 },
    ];
    const { score, results, earned } = scorePicks(probs, [5, null]);
    expect(score).toBe(10);
    expect(results).toEqual(['correct', 'skip']);
    expect(earned).toEqual([10, 0]);
  });
});

describe('mathgen: generators', () => {
  it('covers all registered topics', () => {
    expect(TOPIC_IDS).toEqual(Object.keys(TOPICS));
    expect(TOPIC_IDS.length).toBeGreaterThanOrEqual(4);
  });

  it('every topic: the true answer scores full credit (run many times)', () => {
    for (const topic of TOPIC_IDS) {
      for (let i = 0; i < 50; i++) {
        const p = generate(topic);
        expect(Number.isFinite(p.answer)).toBe(true);
        expect(p.points).toBe(BASE_POINTS);
        const r = scorePick(p, p.answer);
        expect(r.outcome, `${topic} #${i}`).toBe('correct');
        // full credit, plus any near-exact bonus (e.g. sqrt-estimate)
        expect(r.earned).toBeGreaterThanOrEqual(BASE_POINTS);
      }
    }
  });

  it('toPublic strips every secret field', () => {
    for (const topic of TOPIC_IDS) {
      const pub = toPublic(generate(topic));
      expect(pub).not.toHaveProperty('answer');
      expect(pub).not.toHaveProperty('scoring');
      expect(pub).not.toHaveProperty('tol');
      expect(pub).not.toHaveProperty('range');
      expect(pub).toHaveProperty('prompt');
      expect(pub).toHaveProperty('points');
    }
  });

  it('figure topics keep their figure in the public payload', () => {
    const pub = toPublic(generate('geo-pythagoras'));
    expect(pub.figure).toBeTruthy();
    expect(Array.isArray(pub.figure.items)).toBe(true);
    expect(pub.figure.view).toHaveLength(4);
  });

  it('read-graph ships sampled points and no tex/formula', () => {
    let sawGraph = false;
    for (let i = 0; i < 20; i++) {
      const p = generate('read-graph');
      expect(p.graph).toBeTruthy();
      expect(p.graph.points.length).toBeGreaterThan(2);
      expect(p.tex).toBeUndefined();
      sawGraph = true;
    }
    expect(sawGraph).toBe(true);
  });

  it('generateSet returns the requested count', () => {
    expect(generateSet(10).length).toBe(10);
    expect(generateSet(3, ['deriv-poly-eval']).length).toBe(3);
  });

  it('no single-unknown linear-solve topic (too trivial)', () => {
    expect(TOPIC_IDS).not.toContain('linear-solve');
  });
});

describe('mathquiz: near-exact bonus', () => {
  const p = {
    answer: Math.SQRT2,
    scoring: 'proximity',
    tol: 0.02,
    range: 1,
    points: 10,
    bonus: 5,
    bonusTol: 0.005,
  };

  it('near-exact → full credit + bonus, bonus flag set', () => {
    const r = scorePick(p, Math.SQRT2);
    expect(r).toMatchObject({ outcome: 'correct', bonus: true });
    expect(r.earned).toBe(15);
  });
  it('within tol but outside bonusTol → full credit, no bonus', () => {
    const r = scorePick(p, Math.SQRT2 + 0.01);
    expect(r).toMatchObject({ outcome: 'correct', bonus: false });
    expect(r.earned).toBe(10);
  });
  it('partial proximity → graded, no bonus', () => {
    const r = scorePick(p, Math.SQRT2 + 0.5);
    expect(r.outcome).toBe('partial');
    expect(r.bonus).toBe(false);
    expect(r.earned).toBeGreaterThan(0);
    expect(r.earned).toBeLessThan(10);
  });

  it('sqrt-estimate never asks a perfect square', () => {
    for (let i = 0; i < 50; i++) {
      const sp = generate('sqrt-estimate');
      expect(Number.isInteger(sp.answer)).toBe(false);
    }
  });
});
