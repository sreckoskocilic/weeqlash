import { describe, it, expect } from 'vitest';
import {
  HANGMAN_POOL,
  PUZZLE_COUNT,
  TIMER_MS,
  SOLVE_POINTS,
  prefillCount,
  pickWords,
  createPuzzle,
  pattern,
  guessLetter,
  scorePuzzle,
  leaksName,
} from '../server/game/pokedome.ts';

describe('pokedome: pool', () => {
  it('holds only A–Z names', () => {
    expect(HANGMAN_POOL.length).toBeGreaterThan(900);
    for (const w of HANGMAN_POOL) {
      expect(w).toMatch(/^[A-Z]+$/);
    }
  });

  it('picks distinct words for a run', () => {
    for (let i = 0; i < 50; i++) {
      const words = pickWords(PUZZLE_COUNT);
      expect(words).toHaveLength(PUZZLE_COUNT);
      expect(new Set(words).size).toBe(PUZZLE_COUNT);
    }
  });
});

describe('pokedome: puzzle', () => {
  it('prefills 1–3 letters by length', () => {
    expect(prefillCount(4)).toBe(1);
    expect(prefillCount(9)).toBe(2);
    expect(prefillCount(10)).toBe(3);
  });

  it('reveals every occurrence of a locked letter and leaves at least two letters hidden', () => {
    for (const word of ['MEW', 'TYRANITAR', 'CRABOMINABLE']) {
      const p = createPuzzle(word);
      const shown = pattern(p);
      for (const [i, c] of [...word].entries()) {
        expect(shown[i]).toBe(p.locked.includes(c) ? c : null);
      }
      const hidden = new Set([...word].filter((c) => !p.locked.includes(c)));
      expect(hidden.size).toBeGreaterThanOrEqual(2);
    }
  });

  it('never exposes the word in the public pattern', () => {
    const p = createPuzzle('PIKACHU');
    expect(pattern(p).filter(Boolean).length).toBeLessThan('PIKACHU'.length);
  });

  it('hints a regular ability, never a hidden one', () => {
    expect(['Static']).toContain(createPuzzle('PIKACHU').hint);
    expect(['Synchronize', 'Inner Focus']).toContain(createPuzzle('ABRA').hint);
  });

  it('drops abilities that spell out part of the name', () => {
    expect(leaksName('SANDSHREW', 'Sand Veil')).toBe(true);
    expect(leaksName('MAGNEMITE', 'Sturdy')).toBe(false);
    expect(createPuzzle('MAGNEMITE').hint).toBe('Sturdy');
    expect(createPuzzle('PLUSLE').hint).toBeNull();
  });

  it('returns hit positions, counts misses, ignores repeats, detects solve', () => {
    const p = createPuzzle('ABRA', () => 0);
    const locked = p.locked[0];
    expect(guessLetter(p, locked)).toMatchObject({ repeat: true, hit: false });
    expect(guessLetter(p, 'Z')).toMatchObject({ hit: false, repeat: false, positions: [] });
    expect(guessLetter(p, 'Z')).toMatchObject({ repeat: true });
    expect(p.wrong).toBe(1);
    const remaining = [...new Set('ABRA')].filter((c) => !p.known.has(c));
    let last;
    for (const c of remaining) {
      last = guessLetter(p, c);
      expect(last.hit).toBe(true);
    }
    expect(last.solved).toBe(true);
    expect(guessLetter(p, 'A').positions).toEqual([]);
  });
});

describe('pokedome: scoring', () => {
  it('perfect and on par is 100, whatever the name length', () => {
    expect(scorePuzzle(4000, 0, 2)).toBe(100);
    expect(scorePuzzle(12000, 0, 4)).toBe(100);
    expect(scorePuzzle(20000, 0, 7)).toBe(100);
  });

  it('wrong letters shrink the bonus by a fifth each', () => {
    expect(scorePuzzle(12000, 1, 4)).toBe(86);
    expect(scorePuzzle(12000, 2, 4)).toBe(75);
  });

  it('speed bonus fades to zero at three times par', () => {
    expect(scorePuzzle(24000, 0, 4)).toBe(90);
    expect(scorePuzzle(36000, 0, 4)).toBe(80);
  });

  it('a solve never drops below the guaranteed points', () => {
    expect(scorePuzzle(TIMER_MS, 22, 4)).toBe(SOLVE_POINTS);
  });

  it('counts only hidden distinct letters as work', () => {
    const p = createPuzzle('TYRANITAR', () => 0);
    expect(p.hidden).toBe(new Set('TYRANITAR').size - p.locked.length);
  });
});
