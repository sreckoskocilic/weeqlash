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
  effectiveness,
  createRun,
  createWeakPuzzle,
  createTypesPuzzle,
  createOrderPuzzle,
  submitPicks,
  toPublic,
  TYPE_OPTIONS,
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
  it('perfect and on par is 100, whatever the puzzle', () => {
    expect(scorePuzzle(6000, 0, 6000)).toBe(100);
    expect(scorePuzzle(12000, 0, 12000)).toBe(100);
    expect(scorePuzzle(21000, 0, 21000)).toBe(100);
  });

  it('wrong attempts shrink the bonus by a fifth each', () => {
    expect(scorePuzzle(12000, 1, 12000)).toBe(86);
    expect(scorePuzzle(12000, 2, 12000)).toBe(75);
  });

  it('speed bonus fades to zero at three times par', () => {
    expect(scorePuzzle(24000, 0, 12000)).toBe(90);
    expect(scorePuzzle(36000, 0, 12000)).toBe(80);
  });

  it('a solve never drops below the guaranteed points', () => {
    expect(scorePuzzle(TIMER_MS, 22, 12000)).toBe(SOLVE_POINTS);
  });

  it('par counts only hidden distinct letters', () => {
    const p = createPuzzle('TYRANITAR', () => 0);
    expect(p.parMs).toBe((new Set('TYRANITAR').size - p.locked.length) * 3000);
  });
});

const GYARADOS = { name: 'Gyarados', types: ['water', 'flying'] };
const SCIZOR = { name: 'Scizor', types: ['bug', 'steel'] };

describe('pokedome: select all', () => {
  it('multiplies dual-type factors; zero is immunity', () => {
    expect(effectiveness('electric', GYARADOS.types)).toBe(4);
    expect(effectiveness('ground', GYARADOS.types)).toBe(0);
    expect(effectiveness('fire', SCIZOR.types)).toBe(4);
  });

  it('super-effective vs GYARADOS is exactly Electric + Rock', () => {
    const p = createWeakPuzzle(GYARADOS);
    expect(p.prompt).toContain('GYARADOS');
    expect(p.options).toEqual(TYPE_OPTIONS);
    expect(p.answer.sort()).toEqual(['Electric', 'Rock']);
  });

  it('accepts the set in any order; a wrong set costs once, repeats are free', () => {
    const p = createTypesPuzzle(SCIZOR);
    expect(submitPicks(p, ['Bug'])).toEqual({ correct: false, repeat: false });
    expect(submitPicks(p, ['Bug'])).toEqual({ correct: false, repeat: true });
    expect(p.wrong).toBe(1);
    expect(submitPicks(p, ['Steel', 'Bug'])).toEqual({ correct: true, repeat: false });
  });

  it('rejects malformed picks without a penalty', () => {
    const p = createTypesPuzzle(SCIZOR);
    for (const bad of [null, [], ['Bug', 'Bug'], ['Shadow'], 'Bug']) {
      expect(submitPicks(p, bad)).toBeNull();
    }
    expect(p.wrong).toBe(0);
  });
});

describe('pokedome: order', () => {
  it('four close but distinct values, answer sorted ascending', () => {
    for (let i = 0; i < 50; i++) {
      const p = createOrderPuzzle();
      expect(p.options).toHaveLength(4);
      expect(new Set(p.options).size).toBe(4);
      expect([...p.answer].sort()).toEqual([...p.options].sort());
    }
  });

  it('needs the full order; partial picks are malformed', () => {
    const p = createOrderPuzzle();
    expect(submitPicks(p, p.answer.slice(0, 3))).toBeNull();
    expect(submitPicks(p, [...p.answer].reverse()).correct).toBe(false);
    expect(submitPicks(p, p.answer).correct).toBe(true);
  });
});

describe('pokedome: run', () => {
  it('two of each kind, two distinct hangman words', () => {
    const run = createRun();
    expect(run).toHaveLength(PUZZLE_COUNT);
    const kinds = run.map((p) => p.kind).sort();
    expect(kinds).toEqual(['hangman', 'hangman', 'order', 'order', 'select', 'select']);
    const words = run.filter((p) => p.kind === 'hangman').map((p) => p.word);
    expect(new Set(words).size).toBe(2);
  });

  it('public view never carries the answer', () => {
    for (const p of createRun()) {
      const pub = JSON.stringify(toPublic(p));
      expect(pub).not.toContain('answer');
      if (p.kind === 'hangman') {
        expect(pub).not.toContain(p.word);
      }
    }
  });
});
