import { describe, it, expect } from 'vitest';
import { QUIZ_MODES, QUIZ_MODES_BY_ID } from '../server/game/quiz-modes.ts';

describe('Quiz Modes', () => {
  it('exports correct modes', () => {
    expect(QUIZ_MODES).toHaveLength(2);
    expect(QUIZ_MODES[0].id).toBe('triviandom');
    expect(QUIZ_MODES[1].id).toBe('epl_2025');
  });

  it('exports QUIZ_MODES_BY_ID lookup', () => {
    expect(QUIZ_MODES_BY_ID.triviandom).toBeDefined();
    expect(QUIZ_MODES_BY_ID.epl_2025).toBeDefined();
    expect(QUIZ_MODES_BY_ID.triviandom.table).toBe('leaderboard');
    expect(QUIZ_MODES_BY_ID.epl_2025.table).toBe('leaderboard_epl2025');
  });

  it('mode categories are correct', () => {
    expect(QUIZ_MODES_BY_ID.triviandom.categories).toBeNull();
    expect(QUIZ_MODES_BY_ID.epl_2025.categories).toEqual(['epl_2025']);
  });

  it('mode labels are correct', () => {
    expect(QUIZ_MODES_BY_ID.triviandom.label).toBe('Triviandom');
    expect(QUIZ_MODES_BY_ID.epl_2025.label).toBe('EPL 2025');
  });

  it('each mode has required fields', () => {
    for (const mode of QUIZ_MODES) {
      expect(mode.id).toBeDefined();
      expect(mode.label).toBeDefined();
      expect(mode.table).toBeDefined();
      expect(mode.table).toMatch(/^[a-zA-Z0-9_]+$/);
    }
  });
});