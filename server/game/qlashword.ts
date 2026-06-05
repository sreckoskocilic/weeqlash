// Pure Qlashword game logic — no I/O, no socket, no DB. All functions take
// state/data as args and return new data. Question-picking and dictionary
// loading live outside (index.js / qlashword-dict.ts); the dictionary is passed
// in as a Set so this module stays pure and unit-testable.
//
// Qlashword = 1v1 Scrabble where the premium squares (2×/3× letter & word) are
// LOCKED by default. After a player's word is validated, every premium square
// their new tiles cover triggers a trivia question (random from the whole pool,
// minus death_metal). A correct answer UNLOCKS that multiplier for this turn; a
// wrong answer leaves it at ×1 (no-unlock — the base score is never lost).

import type { Category } from './engine.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BOARD_SIZE = 15;
export const RACK_SIZE = 7;
export const BINGO_BONUS = 50; // all 7 tiles used in one turn (free, not gated)
export const CENTER = 7; // first move must cover (7,7)
export const END_PASS_STREAK = 4; // both players pass twice in a row → game over

export const PHASE = {
  PLACE: 'place', // current player is placing tiles
  BONUS_Q: 'bonus_q', // answering the gated premium questions
  GAME_OVER: 'game_over',
} as const;

export type Phase = (typeof PHASE)[keyof typeof PHASE];

export type BonusType = 'DL' | 'TL' | 'DW' | 'TW';
export type Orientation = 'H' | 'V';

// Bonus questions are pulled from every category EXCEPT death_metal.
// (Consumers build the enabled-cats Set; this is the canonical exclusion.)
export const BONUS_Q_EXCLUDED_CATS: readonly Category[] = ['death_metal'];

// Standard English Scrabble tile values.
export const LETTER_VALUES: Record<string, number> = {
  A: 1,
  E: 1,
  I: 1,
  O: 1,
  U: 1,
  L: 1,
  N: 1,
  S: 1,
  T: 1,
  R: 1,
  D: 2,
  G: 2,
  B: 3,
  C: 3,
  M: 3,
  P: 3,
  F: 4,
  H: 4,
  V: 4,
  W: 4,
  Y: 4,
  K: 5,
  J: 8,
  X: 8,
  Q: 10,
  Z: 10,
  _: 0, // blank
};

// Standard English Scrabble tile distribution (100 tiles total).
export const LETTER_DISTRIBUTION: Record<string, number> = {
  A: 9,
  B: 2,
  C: 2,
  D: 4,
  E: 12,
  F: 2,
  G: 3,
  H: 2,
  I: 9,
  J: 1,
  K: 1,
  L: 4,
  M: 2,
  N: 6,
  O: 8,
  P: 2,
  Q: 1,
  R: 6,
  S: 4,
  T: 6,
  U: 4,
  V: 2,
  W: 2,
  X: 1,
  Y: 2,
  Z: 1,
  _: 2, // blanks
};

// Standard 15×15 premium-square layout.
//   3 = triple word, 2 = double word, * = center (double word),
//   t = triple letter, d = double letter, . = normal
const BONUS_LAYOUT = [
  '3..d...3...d..3',
  '.2...t...t...2.',
  '..2...d.d...2..',
  'd..2...d...2..d',
  '....2.....2....',
  '.t...t...t...t.',
  '..d...d.d...d..',
  '3..d...*...d..3',
  '..d...d.d...d..',
  '.t...t...t...t.',
  '....2.....2....',
  'd..2...d...2..d',
  '..2...d.d...2..',
  '.2...t...t...2.',
  '3..d...3...d..3',
];

const BONUS_CHAR_MAP: Record<string, BonusType> = {
  '3': 'TW',
  '2': 'DW',
  '*': 'DW',
  t: 'TL',
  d: 'DL',
};

// Parsed board: BOARD_BONUS[row][col] = BonusType | null
export const BOARD_BONUS: (BonusType | null)[][] = BONUS_LAYOUT.map((row) =>
  [...row].map((ch) => BONUS_CHAR_MAP[ch] ?? null),
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// A settled board cell. `blank` marks a tile that came from a blank (value 0).
export interface Cell {
  letter: string; // 'A'..'Z'
  blank: boolean;
}

export type Board = (Cell | null)[][];

// One tile a player drops this turn. `blank` => the rack tile was '_'; `letter`
// is the letter the player assigned it.
export interface PlacedTile {
  row: number;
  col: number;
  letter: string;
  blank: boolean;
}

// A tile as it participates in a formed word (includes pre-existing tiles).
export interface WordTile {
  row: number;
  col: number;
  letter: string;
  blank: boolean;
  isNew: boolean; // placed this turn → eligible for premium squares
}

export interface FormedWord {
  word: string;
  tiles: WordTile[];
}

// A premium square that a new tile covered → needs a gated question.
export interface BonusSquare {
  row: number;
  col: number;
  bonusType: BonusType;
}

export interface QlashwordState {
  board: Board;
  bag: string[]; // tiles not yet drawn (draw from the end)
  racks: [string[], string[]];
  scores: [number, number];
  currentPlayerIdx: 0 | 1;
  phase: Phase;
  passStreak: number;
  turnNumber: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function coordKey(row: number, col: number): string {
  return `${row},${col}`;
}

export function letterValue(letter: string, blank: boolean): number {
  if (blank) {
    return 0;
  }
  return LETTER_VALUES[letter] ?? 0;
}

function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

function emptyBoard(): Board {
  return Array.from({ length: BOARD_SIZE }, () => Array<Cell | null>(BOARD_SIZE).fill(null));
}

// ---------------------------------------------------------------------------
// Bag
// ---------------------------------------------------------------------------

// Build the full 100-tile bag in canonical order (NOT shuffled — callers shuffle
// or inject a known bag for tests).
export function createBag(): string[] {
  const bag: string[] = [];
  for (const [letter, count] of Object.entries(LETTER_DISTRIBUTION)) {
    for (let i = 0; i < count; i++) {
      bag.push(letter);
    }
  }
  return bag;
}

// Fisher–Yates in place. `rng` defaults to Math.random; inject for deterministic tests.
export function shuffleBag(bag: string[], rng: () => number = Math.random): string[] {
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

// Draw up to `n` tiles off the end of the bag (mutates bag, returns drawn).
export function drawTiles(bag: string[], n: number): string[] {
  return bag.splice(Math.max(0, bag.length - n), n);
}

// Top a rack back up to RACK_SIZE from the bag (mutates both).
export function refillRack(rack: string[], bag: string[]): void {
  const need = RACK_SIZE - rack.length;
  if (need > 0) {
    rack.push(...drawTiles(bag, need));
  }
}

// ---------------------------------------------------------------------------
// Create game
// ---------------------------------------------------------------------------

export interface CreateGameOpts {
  bag?: string[]; // inject a known (already-ordered) bag for tests
  rng?: () => number;
}

export function createGame(opts: CreateGameOpts = {}): QlashwordState {
  const bag = opts.bag ? opts.bag.slice() : shuffleBag(createBag(), opts.rng);
  const racks: [string[], string[]] = [drawTiles(bag, RACK_SIZE), drawTiles(bag, RACK_SIZE)];
  return {
    board: emptyBoard(),
    bag,
    racks,
    scores: [0, 0],
    currentPlayerIdx: 0,
    phase: PHASE.PLACE,
    passStreak: 0,
    turnNumber: 1,
  };
}

// ---------------------------------------------------------------------------
// Placement validation
// ---------------------------------------------------------------------------

export type ValidationResult =
  | { ok: true; orientation: Orientation }
  | { ok: false; error: string };

// Validate the geometry of a placement against the current board. Does NOT check
// the dictionary — call collectWords + a dict lookup for that.
//
// Rules: tiles in a single row or column, contiguous (gaps may be filled by
// EXISTING tiles), no overlap with occupied cells, first move covers center,
// later moves connect to ≥1 existing tile.
export function validatePlacement(board: Board, placement: PlacedTile[]): ValidationResult {
  if (placement.length === 0) {
    return { ok: false, error: 'No tiles placed' };
  }

  for (const t of placement) {
    if (!inBounds(t.row, t.col)) {
      return { ok: false, error: `Tile out of bounds at ${coordKey(t.row, t.col)}` };
    }
    if (board[t.row][t.col] !== null) {
      return { ok: false, error: `Cell already occupied at ${coordKey(t.row, t.col)}` };
    }
  }

  // No two placed tiles on the same cell.
  const seen = new Set<string>();
  for (const t of placement) {
    const k = coordKey(t.row, t.col);
    if (seen.has(k)) {
      return { ok: false, error: `Duplicate tile at ${k}` };
    }
    seen.add(k);
  }

  const rows = new Set(placement.map((t) => t.row));
  const cols = new Set(placement.map((t) => t.col));
  let orientation: Orientation;
  if (rows.size === 1) {
    orientation = 'H';
  } else if (cols.size === 1) {
    orientation = 'V';
  } else {
    return { ok: false, error: 'Tiles must be in a single row or column' };
  }

  const boardEmpty = board.every((row) => row.every((c) => c === null));

  // Contiguity: scan the full line between min and max; every intermediate cell
  // must hold either a newly placed tile or an existing tile.
  if (orientation === 'H') {
    const row = placement[0].row;
    const cs = placement.map((t) => t.col);
    const [lo, hi] = [Math.min(...cs), Math.max(...cs)];
    for (let c = lo; c <= hi; c++) {
      const placedHere = seen.has(coordKey(row, c));
      if (!placedHere && board[row][c] === null) {
        return { ok: false, error: 'Gap in placement' };
      }
    }
  } else {
    const col = placement[0].col;
    const rs = placement.map((t) => t.row);
    const [lo, hi] = [Math.min(...rs), Math.max(...rs)];
    for (let r = lo; r <= hi; r++) {
      const placedHere = seen.has(coordKey(r, col));
      if (!placedHere && board[r][col] === null) {
        return { ok: false, error: 'Gap in placement' };
      }
    }
  }

  if (boardEmpty) {
    if (!seen.has(coordKey(CENTER, CENTER))) {
      return { ok: false, error: 'First move must cover the center square' };
    }
  } else {
    // Must touch at least one existing tile (orthogonally adjacent).
    const touches = placement.some((t) =>
      [
        [t.row - 1, t.col],
        [t.row + 1, t.col],
        [t.row, t.col - 1],
        [t.row, t.col + 1],
      ].some(([r, c]) => inBounds(r, c) && board[r][c] !== null),
    );
    if (!touches) {
      return { ok: false, error: 'Placement must connect to an existing tile' };
    }
  }

  return { ok: true, orientation };
}

// ---------------------------------------------------------------------------
// Word collection
// ---------------------------------------------------------------------------

// Merge placement onto a copy of the board so we can read formed words. Caller
// should have already validated geometry.
function mergeBoard(board: Board, placement: PlacedTile[]): Board {
  const merged = board.map((row) => row.slice());
  for (const t of placement) {
    merged[t.row][t.col] = { letter: t.letter, blank: t.blank };
  }
  return merged;
}

// Walk a merged-board run from a start cell in one direction, collecting the
// full contiguous word (>=1 letters). `newSet` flags which coords are new.
function readWord(
  merged: Board,
  startR: number,
  startC: number,
  dr: number,
  dc: number,
  newSet: Set<string>,
): FormedWord {
  // back up to the start of the run
  let r = startR;
  let c = startC;
  while (inBounds(r - dr, c - dc) && merged[r - dr][c - dc] !== null) {
    r -= dr;
    c -= dc;
  }
  const tiles: WordTile[] = [];
  let word = '';
  while (inBounds(r, c) && merged[r][c] !== null) {
    const cell = merged[r][c]!;
    tiles.push({
      row: r,
      col: c,
      letter: cell.letter,
      blank: cell.blank,
      isNew: newSet.has(coordKey(r, c)),
    });
    word += cell.letter;
    r += dr;
    c += dc;
  }
  return { word, tiles };
}

// All words formed by a placement: the main word along the placement line, plus
// any perpendicular cross-words each new tile creates. Only words of length >=2
// count. Assumes geometry already validated.
export function collectWords(
  board: Board,
  placement: PlacedTile[],
  orientation: Orientation,
): FormedWord[] {
  const merged = mergeBoard(board, placement);
  const newSet = new Set(placement.map((t) => coordKey(t.row, t.col)));
  const words: FormedWord[] = [];

  const [mr, mc] = orientation === 'H' ? [0, 1] : [1, 0]; // main direction
  const [cr, cc] = orientation === 'H' ? [1, 0] : [0, 1]; // cross direction

  // Main word (anchor on any placed tile).
  const anchor = placement[0];
  const main = readWord(merged, anchor.row, anchor.col, mr, mc, newSet);
  if (main.tiles.length >= 2) {
    words.push(main);
  }

  // Cross words — one per new tile, in the perpendicular direction.
  for (const t of placement) {
    const cross = readWord(merged, t.row, t.col, cr, cc, newSet);
    if (cross.tiles.length >= 2) {
      words.push(cross);
    }
  }

  return words;
}

// True iff every formed word is in the dictionary. `dict` holds upper-case words.
export function allWordsValid(words: FormedWord[], dict: Set<string>): boolean {
  return words.every((w) => dict.has(w.word.toUpperCase()));
}

// ---------------------------------------------------------------------------
// Bonus questions
// ---------------------------------------------------------------------------

// Every premium square a NEW tile covered → a gated question. Deduped by coord
// (placement coords are already unique). Caller assigns each a random questionId.
export function planBonusQuestions(placement: PlacedTile[]): BonusSquare[] {
  const out: BonusSquare[] = [];
  for (const t of placement) {
    const bonus = BOARD_BONUS[t.row][t.col];
    if (bonus) {
      out.push({ row: t.row, col: t.col, bonusType: bonus });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface ScoreBreakdown {
  total: number;
  words: { word: string; score: number }[];
  bingo: boolean;
}

// Score a turn. `bonusResults` maps coordKey → true (answered correctly →
// premium unlocked). Missing/false = no-unlock (premium counts as ×1, base kept).
// `tilesPlaced` is how many tiles the player laid this turn (7 → bingo bonus).
export function scoreTurn(
  words: FormedWord[],
  bonusResults: Record<string, boolean>,
  tilesPlaced: number,
): ScoreBreakdown {
  const breakdown: { word: string; score: number }[] = [];
  let total = 0;

  for (const w of words) {
    let wordMult = 1;
    let wordScore = 0;
    for (const tile of w.tiles) {
      let ls = letterValue(tile.letter, tile.blank);
      const prem = tile.isNew ? BOARD_BONUS[tile.row][tile.col] : null;
      const unlocked = prem ? bonusResults[coordKey(tile.row, tile.col)] === true : false;
      if (unlocked) {
        if (prem === 'DL') {
          ls *= 2;
        } else if (prem === 'TL') {
          ls *= 3;
        } else if (prem === 'DW') {
          wordMult *= 2;
        } else if (prem === 'TW') {
          wordMult *= 3;
        }
      }
      wordScore += ls;
    }
    const wordTotal = wordScore * wordMult;
    breakdown.push({ word: w.word, score: wordTotal });
    total += wordTotal;
  }

  const bingo = tilesPlaced === RACK_SIZE;
  if (bingo) {
    total += BINGO_BONUS;
  }

  return { total, words: breakdown, bingo };
}

// ---------------------------------------------------------------------------
// Game over
// ---------------------------------------------------------------------------

// Game ends when the bag is empty AND a player has emptied their rack, or both
// players passed twice in a row.
export function checkGameOver(state: QlashwordState): boolean {
  if (state.passStreak >= END_PASS_STREAK) {
    return true;
  }
  if (state.bag.length === 0 && state.racks.some((r) => r.length === 0)) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Turn application (mutating orchestration — keeps the socket layer thin)
// ---------------------------------------------------------------------------

// Remove the tiles a placement consumed from a rack (blanks consume a '_').
// Returns false (and leaves the rack untouched) if the rack lacks a tile.
export function removeTilesFromRack(rack: string[], placement: PlacedTile[]): boolean {
  const copy = rack.slice();
  for (const t of placement) {
    const needed = t.blank ? '_' : t.letter;
    const idx = copy.indexOf(needed);
    if (idx === -1) {
      return false;
    }
    copy.splice(idx, 1);
  }
  rack.length = 0;
  rack.push(...copy);
  return true;
}

function advanceTurn(state: QlashwordState): void {
  state.currentPlayerIdx = state.currentPlayerIdx === 0 ? 1 : 0;
  state.turnNumber += 1;
}

// Commit a validated, scored turn: place tiles, credit score, consume rack,
// refill from the bag, reset the pass streak, hand off to the opponent.
// `bonusResults` maps coordKey → true for unlocked premiums. Returns the score
// breakdown, or an error if the rack can't cover the placement.
export function applyTurn(
  state: QlashwordState,
  playerIdx: 0 | 1,
  placement: PlacedTile[],
  words: FormedWord[],
  bonusResults: Record<string, boolean>,
): { breakdown: ScoreBreakdown } | { error: string } {
  if (state.currentPlayerIdx !== playerIdx) {
    return { error: 'Not your turn' };
  }
  if (!removeTilesFromRack(state.racks[playerIdx], placement)) {
    return { error: 'Placement uses tiles not on the rack' };
  }
  for (const t of placement) {
    state.board[t.row][t.col] = { letter: t.letter, blank: t.blank };
  }
  const breakdown = scoreTurn(words, bonusResults, placement.length);
  state.scores[playerIdx] += breakdown.total;
  refillRack(state.racks[playerIdx], state.bag);
  state.passStreak = 0;
  advanceTurn(state);
  return { breakdown };
}

// Pass: no tiles played, increments the pass streak, hands off.
export function passTurn(
  state: QlashwordState,
  playerIdx: 0 | 1,
): { ok: true } | { error: string } {
  if (state.currentPlayerIdx !== playerIdx) {
    return { error: 'Not your turn' };
  }
  state.passStreak += 1;
  advanceTurn(state);
  return { ok: true };
}

// Swap rack tiles back into the bag and draw replacements. Loses the turn but
// does NOT count as a pass (it's a move). `indices` index into the rack.
// Requires the bag to hold at least as many tiles as are being swapped.
export function swapTiles(
  state: QlashwordState,
  playerIdx: 0 | 1,
  indices: number[],
): { ok: true } | { error: string } {
  if (state.currentPlayerIdx !== playerIdx) {
    return { error: 'Not your turn' };
  }
  const rack = state.racks[playerIdx];
  const uniq = [...new Set(indices)];
  if (uniq.length === 0 || uniq.some((i) => i < 0 || i >= rack.length)) {
    return { error: 'Invalid swap selection' };
  }
  if (state.bag.length < uniq.length) {
    return { error: 'Not enough tiles in the bag to swap' };
  }
  const returned = uniq.map((i) => rack[i]);
  const kept = rack.filter((_, i) => !uniq.includes(i));
  const drawn = drawTiles(state.bag, uniq.length);
  state.racks[playerIdx] = [...kept, ...drawn];
  state.bag.push(...returned); // returned tiles go back into the bag (reshuffle on next draw is fine)
  state.passStreak = 0;
  advanceTurn(state);
  return { ok: true };
}

// Sum of the tile values left on a rack (the end-game penalty).
export function rackValue(rack: string[]): number {
  return rack.reduce((sum, l) => sum + letterValue(l, l === '_'), 0);
}

// Final score adjustment (classic Scrabble): each player loses the value of
// their leftover rack; if one player emptied their rack first, they also gain
// the sum of everyone else's leftovers. Returns the adjusted [s0, s1].
export function finalScores(state: QlashwordState): [number, number] {
  const left = [rackValue(state.racks[0]), rackValue(state.racks[1])];
  const adjusted: [number, number] = [state.scores[0] - left[0], state.scores[1] - left[1]];
  const emptiedIdx = state.racks.findIndex((r) => r.length === 0);
  if (emptiedIdx !== -1 && state.bag.length === 0) {
    const otherIdx = emptiedIdx === 0 ? 1 : 0;
    adjusted[emptiedIdx] += left[otherIdx];
  }
  return adjusted;
}
