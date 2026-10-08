import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TIMER_MS = 30000;
export const SOLVE_POINTS = 30;
const ACCURACY_POINTS = 50;
const SPEED_POINTS = 20;
const WRONG_DECAY = 0.8;
const PAR_MS_PER_STEP = 3000;
const HINT_LEAK_RUN = 4;
const ORDER_SIZE = 4;
const ORDER_BAND = 30;
const ORDER_MIN_GAP = 5;

type StatKey = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';

interface Species {
  name: string;
  hangman: string | null;
  types: string[];
  stats: Record<StatKey, number>;
  abilities: { name: string; hidden: boolean }[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dex = JSON.parse(fs.readFileSync(path.join(__dirname, 'pokedex.json'), 'utf8')) as {
  types: string[];
  chart: Record<string, Record<string, number>>;
  species: Species[];
};

const STAT_LABEL: Record<StatKey, string> = {
  hp: 'HP',
  atk: 'Attack',
  def: 'Defense',
  spa: 'Sp. Atk',
  spd: 'Sp. Def',
  spe: 'Speed',
};
const STATS = Object.keys(STAT_LABEL) as StatKey[];

const typeLabel = (t: string) => t[0].toUpperCase() + t.slice(1);
export const TYPE_OPTIONS = dex.types.map(typeLabel);

export const HANGMAN_POOL: string[] = dex.species
  .map((s) => s.hangman)
  .filter((w): w is string => !!w);

type Variant = 'hangman' | 'weak' | 'types' | 'order';
const RUN_PLAN: Variant[] = ['hangman', 'hangman', 'weak', 'types', 'order', 'order'];
export const PUZZLE_COUNT = RUN_PLAN.length;

export function leaksName(word: string, ability: string): boolean {
  const letters = ability.toUpperCase().replace(/[^A-Z]/g, '');
  for (let i = 0; i + HINT_LEAK_RUN <= letters.length; i++) {
    if (word.includes(letters.slice(i, i + HINT_LEAK_RUN))) {
      return true;
    }
  }
  return false;
}

const HINTS = new Map(
  dex.species
    .filter((s) => s.hangman)
    .map((s) => [
      s.hangman as string,
      s.abilities
        .filter((a) => !a.hidden && !leaksName(s.hangman as string, a.name))
        .map((a) => a.name),
    ]),
);

export function effectiveness(attack: string, defend: string[]): number {
  return defend.reduce((f, t) => f * dex.chart[attack][t], 1);
}

interface PuzzleBase {
  parMs: number;
  wrong: number;
}

export interface HangmanPuzzle extends PuzzleBase {
  kind: 'hangman';
  word: string;
  hint: string | null;
  locked: string[];
  known: Set<string>;
  missed: Set<string>;
}

export interface PickPuzzle extends PuzzleBase {
  kind: 'select' | 'order';
  prompt: string;
  options: string[];
  answer: string[];
  tried: Set<string>;
}

export type Puzzle = HangmanPuzzle | PickPuzzle;

export interface GuessResult {
  hit: boolean;
  repeat: boolean;
  positions: number[];
  solved: boolean;
}

export function prefillCount(length: number): number {
  return length <= 5 ? 1 : length <= 9 ? 2 : 3;
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const pickOne = <T>(arr: T[], rand: () => number): T => arr[Math.floor(rand() * arr.length)];

export function pickWords(count: number, rand: () => number = Math.random): string[] {
  return shuffle(HANGMAN_POOL, rand).slice(0, count);
}

export function createPuzzle(word: string, rand: () => number = Math.random): HangmanPuzzle {
  const distinct = [...new Set(word)];
  const n = Math.max(0, Math.min(prefillCount(word.length), distinct.length - 2));
  const locked = shuffle(distinct, rand).slice(0, n);
  const hints = HINTS.get(word) ?? [];
  return {
    kind: 'hangman',
    word,
    hint: hints.length ? pickOne(hints, rand) : null,
    locked,
    parMs: (distinct.length - locked.length) * PAR_MS_PER_STEP,
    known: new Set(locked),
    missed: new Set(),
    wrong: 0,
  };
}

function selectPuzzle(prompt: string, answer: string[]): PickPuzzle {
  return {
    kind: 'select',
    prompt,
    options: TYPE_OPTIONS,
    answer,
    parMs: (answer.length + 1) * PAR_MS_PER_STEP,
    tried: new Set(),
    wrong: 0,
  };
}

export function createWeakPuzzle(s: Species): PickPuzzle {
  const answer = dex.types.filter((t) => effectiveness(t, s.types) > 1).map(typeLabel);
  return selectPuzzle(
    `Which types deal super-effective damage to ${s.name.toUpperCase()}?`,
    answer,
  );
}

export function createTypesPuzzle(s: Species): PickPuzzle {
  return selectPuzzle(`Select every type of ${s.name.toUpperCase()}.`, s.types.map(typeLabel));
}

export function createOrderPuzzle(rand: () => number = Math.random): PickPuzzle {
  for (;;) {
    const stat = pickOne(STATS, rand);
    const anchor = pickOne(dex.species, rand).stats[stat];
    const picked: Species[] = [];
    for (const s of shuffle(dex.species, rand)) {
      const v = s.stats[stat];
      if (
        Math.abs(v - anchor) <= ORDER_BAND &&
        picked.every((p) => Math.abs(p.stats[stat] - v) >= ORDER_MIN_GAP)
      ) {
        picked.push(s);
        if (picked.length === ORDER_SIZE) {
          return {
            kind: 'order',
            prompt: `Order by base ${STAT_LABEL[stat]}, lowest to highest.`,
            options: picked.map((p) => p.name),
            answer: [...picked].sort((a, b) => a.stats[stat] - b.stats[stat]).map((p) => p.name),
            parMs: ORDER_SIZE * PAR_MS_PER_STEP,
            tried: new Set(),
            wrong: 0,
          };
        }
      }
    }
  }
}

export function createRun(rand: () => number = Math.random): Puzzle[] {
  const words = pickWords(RUN_PLAN.filter((v) => v === 'hangman').length, rand);
  return shuffle(RUN_PLAN, rand).map((v) => {
    if (v === 'hangman') {
      return createPuzzle(words.pop() as string, rand);
    }
    if (v === 'order') {
      return createOrderPuzzle(rand);
    }
    const s = pickOne(dex.species, rand);
    return v === 'weak' ? createWeakPuzzle(s) : createTypesPuzzle(s);
  });
}

export function pattern(p: HangmanPuzzle): (string | null)[] {
  return [...p.word].map((c) => (p.known.has(c) ? c : null));
}

export function toPublic(p: Puzzle) {
  if (p.kind === 'hangman') {
    return { kind: p.kind, pattern: pattern(p), locked: p.locked, hint: p.hint };
  }
  return { kind: p.kind, prompt: p.prompt, options: p.options };
}

function isSolved(p: HangmanPuzzle): boolean {
  return [...p.word].every((c) => p.known.has(c));
}

export function guessLetter(p: HangmanPuzzle, letter: string): GuessResult {
  if (p.known.has(letter) || p.missed.has(letter)) {
    return { hit: false, repeat: true, positions: [], solved: isSolved(p) };
  }
  const positions = [...p.word].flatMap((c, i) => (c === letter ? [i] : []));
  if (positions.length) {
    p.known.add(letter);
  } else {
    p.missed.add(letter);
    p.wrong += 1;
  }
  return { hit: positions.length > 0, repeat: false, positions, solved: isSolved(p) };
}

export function submitPicks(
  p: PickPuzzle,
  picks: unknown,
): { correct: boolean; repeat: boolean } | null {
  if (
    !Array.isArray(picks) ||
    !picks.length ||
    new Set(picks).size !== picks.length ||
    !picks.every((x) => p.options.includes(x)) ||
    (p.kind === 'order' && picks.length !== p.options.length)
  ) {
    return null;
  }
  const key = (p.kind === 'select' ? [...picks].sort() : picks).join('|');
  const answer = (p.kind === 'select' ? [...p.answer].sort() : p.answer).join('|');
  if (key === answer) {
    return { correct: true, repeat: false };
  }
  if (p.tried.has(key)) {
    return { correct: false, repeat: true };
  }
  p.tried.add(key);
  p.wrong += 1;
  return { correct: false, repeat: false };
}

export function scorePuzzle(elapsedMs: number, wrong: number, parMs: number): number {
  const speed = Math.min(1, Math.max(0, 1 - (elapsedMs - parMs) / (2 * parMs)));
  const earned = WRONG_DECAY ** wrong * (ACCURACY_POINTS + SPEED_POINTS * speed);
  return Math.round(SOLVE_POINTS + earned);
}
