import { describe, it, expect } from 'vitest';
import {
  buildChoices,
  scoreCento,
  COUNTRIES,
  COUNTRIES_BY_SLUG,
  CHOICE_COUNT,
  TIMER_MS,
  POINTS_CORRECT,
  POINTS_WRONG,
  MAX_SCORE,
  MAX_PER_CAT,
} from '../server/game/centographer.ts';

describe('centographer: constants + data', () => {
  it('exports expected values', () => {
    expect(CHOICE_COUNT).toBe(36);
    expect(TIMER_MS).toBe(60000);
    expect(POINTS_CORRECT).toBe(5);
    expect(POINTS_WRONG).toBe(-8);
    expect(MAX_SCORE).toBe(100);
  });
  it('Germany exists with enough correct answers + svg slug', () => {
    const de = COUNTRIES_BY_SLUG.germany;
    expect(de).toBeTruthy();
    expect(de.correct.length).toBeGreaterThanOrEqual(24);
    expect(de.slug).toBe('germany');
  });
});

describe('centographer: buildChoices', () => {
  it('CHOICE_COUNT unique choices, hidden variable #correct, per-category cap, no leaks', () => {
    const de = COUNTRIES[0];
    const correctLabels = new Set(de.correct.map((i) => i.label));
    const catOf = new Map(de.correct.map((i) => [i.label, i.cat]));
    const counts = new Set();
    for (let i = 0; i < 60; i++) {
      const ch = buildChoices(de);
      expect(ch).toHaveLength(CHOICE_COUNT);
      expect(new Set(ch.map((c) => c.id)).size).toBe(CHOICE_COUNT);
      const nc = ch.filter((c) => c.correct).length;
      expect(nc).toBeGreaterThanOrEqual(1);
      expect(nc).toBeLessThan(CHOICE_COUNT);
      counts.add(nc);
      // correct choices must be real German answers; distractors must not be
      for (const c of ch) {
        if (c.correct) {
          expect(correctLabels.has(c.label)).toBe(true);
        } else {
          expect(correctLabels.has(c.label)).toBe(false);
        }
      }
      // at most MAX_PER_CAT correct items from any one category
      const perCat = {};
      for (const c of ch) {
        if (c.correct) {
          const cat = catOf.get(c.label);
          perCat[cat] = (perCat[cat] || 0) + 1;
        }
      }
      for (const cat in perCat) {
        expect(perCat[cat], `correct cat ${cat}`).toBeLessThanOrEqual(MAX_PER_CAT);
      }
    }
    expect(counts.size).toBeGreaterThan(1); // #correct actually varies
  });
});

describe('centographer: scoreCento', () => {
  const choices = [
    { id: 'a', correct: true },
    { id: 'b', correct: true },
    { id: 'c', correct: false },
    { id: 'd', correct: false },
  ];

  it('all correct, none wrong → sum of +5', () => {
    expect(scoreCento(choices, ['a', 'b'])).toMatchObject({
      score: 10,
      correctPicked: 2,
      wrongPicked: 0,
    });
  });
  it('wrong picks subtract 8 each', () => {
    expect(scoreCento(choices, ['a', 'c'])).toMatchObject({
      score: 5 - 8,
      correctPicked: 1,
      wrongPicked: 1,
    });
  });
  it('can go negative (no lower floor)', () => {
    expect(scoreCento(choices, ['c', 'd']).score).toBe(-16);
  });
  it('caps at MAX_SCORE', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: 'x' + i, correct: true }));
    const r = scoreCento(
      many,
      many.map((c) => c.id),
    );
    expect(r.score).toBe(100); // 30*5=150 capped
  });
  it('nothing selected → 0', () => {
    expect(scoreCento(choices, []).score).toBe(0);
  });
});
