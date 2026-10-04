import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PUZZLE_COUNT = 3;
export const TIMER_MS = 30000;
export const SOLVE_POINTS = 30;
const ACCURACY_POINTS = 50;
const SPEED_POINTS = 20;
const WRONG_DECAY = 0.8;
const PAR_MS_PER_LETTER = 3000;

interface Species {
  hangman: string | null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dex = JSON.parse(fs.readFileSync(path.join(__dirname, 'pokedex.json'), 'utf8')) as {
  species: Species[];
};

export const HANGMAN_POOL: string[] = dex.species
  .map((s) => s.hangman)
  .filter((w): w is string => !!w);

export interface Puzzle {
  word: string;
  locked: string[];
  hidden: number;
  known: Set<string>;
  missed: Set<string>;
  wrong: number;
}

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

export function pickWords(count: number, rand: () => number = Math.random): string[] {
  return shuffle(HANGMAN_POOL, rand).slice(0, count);
}

export function createPuzzle(word: string, rand: () => number = Math.random): Puzzle {
  const distinct = [...new Set(word)];
  const n = Math.max(0, Math.min(prefillCount(word.length), distinct.length - 2));
  const locked = shuffle(distinct, rand).slice(0, n);
  return {
    word,
    locked,
    hidden: distinct.length - locked.length,
    known: new Set(locked),
    missed: new Set(),
    wrong: 0,
  };
}

export function pattern(p: Puzzle): (string | null)[] {
  return [...p.word].map((c) => (p.known.has(c) ? c : null));
}

export function isSolved(p: Puzzle): boolean {
  return [...p.word].every((c) => p.known.has(c));
}

export function guessLetter(p: Puzzle, letter: string): GuessResult {
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

export function scorePuzzle(elapsedMs: number, wrong: number, hidden: number): number {
  const parMs = hidden * PAR_MS_PER_LETTER;
  const speed = Math.min(1, Math.max(0, 1 - (elapsedMs - parMs) / (2 * parMs)));
  const earned = WRONG_DECAY ** wrong * (ACCURACY_POINTS + SPEED_POINTS * speed);
  return Math.round(SOLVE_POINTS + earned);
}
