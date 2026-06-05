import { describe, it, expect } from 'vitest';
import { loadDictionary, isWord } from '../server/game/qlashword-dict.ts';

describe('Qlashword dictionary', () => {
  const dict = loadDictionary();

  it('loads the full TWL06 list', () => {
    expect(dict.size).toBeGreaterThan(170000);
  });

  it('contains common words', () => {
    for (const w of ['QUIZ', 'CAT', 'WORD', 'OX', 'QI', 'ZA']) {
      expect(dict.has(w)).toBe(true);
    }
  });

  it('rejects non-words', () => {
    expect(dict.has('ZZQX')).toBe(false);
    expect(isWord('notaword', dict)).toBe(false);
  });

  it('isWord is case-insensitive', () => {
    expect(isWord('quiz', dict)).toBe(true);
    expect(isWord('Cat', dict)).toBe(true);
  });

  it('drops single letters and over-long entries', () => {
    expect(dict.has('A')).toBe(false);
    expect([...dict].every((w) => w.length >= 2 && w.length <= 15)).toBe(true);
  });
});
