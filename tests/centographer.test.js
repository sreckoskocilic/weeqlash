import { describe, it, expect } from 'vitest';
import {
  buildChoices,
  scoreCento,
  COUNTRIES,
  COUNTRIES_BY_SLUG,
  CHOICE_COUNT,
  MAX_PER_CAT,
  NO_DISTRACT,
  ABSURD,
} from '../server/game/centographer.ts';

// label -> the category it belongs to, across every country's correct pool plus
// the absurd set. Used to inspect a built grid (choices carry no category).
const LABEL_CAT = new Map();
for (const c of COUNTRIES) {
  for (const item of c.correct) {
    if (!LABEL_CAT.has(item.label)) {
      LABEL_CAT.set(item.label, item.cat);
    }
  }
}
for (const item of ABSURD) {
  if (!LABEL_CAT.has(item.label)) {
    LABEL_CAT.set(item.label, item.cat);
  }
}
const ABSURD_LABELS = new Set(ABSURD.map((i) => i.label));

describe('centographer: data', () => {
  it('loads the generated country dataset', () => {
    expect(COUNTRIES.length).toBeGreaterThan(150);
    for (const c of COUNTRIES) {
      expect(typeof c.slug).toBe('string');
      expect(c.correct.length).toBeGreaterThanOrEqual(8);
      expect(Array.isArray(c.langs)).toBe(true);
      expect(Array.isArray(c.neighbors)).toBe(true);
      expect(typeof c.continent).toBe('string');
    }
  });

  it('Germany has both structural and cultural answers', () => {
    const de = COUNTRIES_BY_SLUG.germany;
    expect(de).toBeTruthy();
    expect(de.slug).toBe('germany');
    expect(de.correct.length).toBeGreaterThanOrEqual(50);
    const cats = new Set(de.correct.map((i) => i.cat));
    // structural (from the dump) + cultural (from the overlay)
    for (const cat of ['city', 'river', 'mountain', 'club', 'person', 'border']) {
      expect(cats.has(cat), `Germany missing cat ${cat}`).toBe(true);
    }
    expect(de.neighbors).toContain('france');
  });
});

describe('centographer: buildChoices', () => {
  it('every country builds a valid grid', () => {
    for (const country of COUNTRIES) {
      const ch = buildChoices(country);
      expect(ch).toHaveLength(CHOICE_COUNT);
      expect(new Set(ch.map((c) => c.id)).size).toBe(CHOICE_COUNT);
      expect(new Set(ch.map((c) => c.label)).size).toBe(CHOICE_COUNT); // no dup labels
      const correct = ch.filter((c) => c.correct);
      expect(correct.length).toBeGreaterThanOrEqual(1);
      expect(correct.length).toBeLessThan(CHOICE_COUNT);
      const correctLabels = new Set(country.correct.map((i) => i.label));
      for (const c of ch) {
        expect(correctLabels.has(c.label)).toBe(c.correct);
      }
    }
  });

  it('Germany: #correct varies, per-cat capped, no weak/over-frequent distractors', () => {
    const de = COUNTRIES_BY_SLUG.germany;
    const catOf = new Map(de.correct.map((i) => [i.label, i.cat]));
    const counts = new Set();
    for (let i = 0; i < 80; i++) {
      const ch = buildChoices(de);
      counts.add(ch.filter((c) => c.correct).length);

      // correct items: at most MAX_PER_CAT from any one category
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

      // distractors are never from the correct-only categories...
      let absurdSeen = 0;
      for (const c of ch) {
        if (c.correct) {
          continue;
        }
        const cat = LABEL_CAT.get(c.label);
        if (cat) {
          expect(NO_DISTRACT.has(cat), `distractor cat ${cat}`).toBe(false);
        }
        if (ABSURD_LABELS.has(c.label)) {
          absurdSeen++;
        }
      }
      // ...and at most two absurd (fiction/myth) give-aways per grid
      expect(absurdSeen).toBeLessThanOrEqual(2);
    }
    expect(counts.size).toBeGreaterThan(1); // #correct actually varies run to run
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
