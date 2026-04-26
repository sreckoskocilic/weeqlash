import { describe, it, expect } from 'vitest';
import { QUIZ_MODES, QUIZ_MODES_BY_ID } from '../server/game/quiz-modes.ts';

describe('Quiz Modes', () => {
  it('every mode has the required shape', () => {
    expect(QUIZ_MODES.length).toBeGreaterThan(0);
    for (const mode of QUIZ_MODES) {
      expect(typeof mode.id).toBe('string');
      expect(mode.id).toMatch(/^[a-z0-9_]+$/);
      expect(typeof mode.label).toBe('string');
      expect(mode.label.length).toBeGreaterThan(0);
      expect(mode.categories === null || Array.isArray(mode.categories)).toBe(true);
    }
  });

  it('mode ids are unique', () => {
    const ids = QUIZ_MODES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('exports QUIZ_MODES_BY_ID lookup', () => {
    expect(QUIZ_MODES_BY_ID.triviandom).toBeDefined();
    expect(QUIZ_MODES_BY_ID.triviandom.label).toBe('Triviandom');
    expect(QUIZ_MODES_BY_ID.triviandom.categories).toBeNull();
  });

  it('includes skipnot mode', () => {
    expect(QUIZ_MODES_BY_ID.skipnot).toBeDefined();
    expect(QUIZ_MODES_BY_ID.skipnot.label).toBe('SkipNoT');
    expect(QUIZ_MODES_BY_ID.skipnot.categories).toBeNull();
  });
});
