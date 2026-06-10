import { describe, it, expect } from 'vitest';
import {
  BOARD_SIZE,
  RACK_SIZE,
  BINGO_BONUS,
  CENTER,
  BOARD_BONUS,
  LETTER_VALUES,
  createBag,
  createGame,
  drawTiles,
  refillRack,
  removeTilesFromRack,
  applyTurn,
  passTurn,
  swapTiles,
  rackValue,
  validatePlacement,
  collectWords,
  allWordsValid,
  planBonusQuestions,
  scoreTurn,
  checkGameOver,
  finalScores,
  coordKey,
} from '../server/game/qlashword.ts';

// --- helpers ---------------------------------------------------------------

// Build an empty 15×15 board.
function emptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
}

// Place settled cells on a board: list of [row, col, letter].
function withCells(board, cells) {
  for (const [r, c, letter] of cells) {
    board[r][c] = { letter, blank: false };
  }
  return board;
}

// Turn a string of letters into a horizontal placement starting at (row, col).
function hPlace(row, col, word, { blanks = [] } = {}) {
  return [...word].map((letter, i) => ({
    row,
    col: col + i,
    letter,
    blank: blanks.includes(i),
  }));
}

function vPlace(row, col, word, { blanks = [] } = {}) {
  return [...word].map((letter, i) => ({
    row: row + i,
    col,
    letter,
    blank: blanks.includes(i),
  }));
}

const DICT = new Set(['QUIZ', 'CAT', 'CATS', 'AT', 'AS', 'WORD', 'WORDS', 'IT', 'HI', 'OX', 'TO']);

// --- bag / draw ------------------------------------------------------------

describe('Qlashword: bag & draw', () => {
  it('builds a 100-tile bag', () => {
    expect(createBag()).toHaveLength(100);
  });

  it('has 2 blanks worth 0 points', () => {
    expect(createBag().filter((t) => t === '_')).toHaveLength(2);
    expect(LETTER_VALUES._).toBe(0);
  });

  it('drawTiles takes from the end and mutates the bag', () => {
    const bag = ['A', 'B', 'C', 'D'];
    const drawn = drawTiles(bag, 2);
    expect(drawn).toEqual(['C', 'D']);
    expect(bag).toEqual(['A', 'B']);
  });

  it('drawTiles is safe when asking for more than the bag holds', () => {
    const bag = ['A'];
    expect(drawTiles(bag, 5)).toEqual(['A']);
    expect(bag).toEqual([]);
  });

  it('refillRack tops a rack back up to RACK_SIZE', () => {
    const rack = ['A', 'B'];
    const bag = ['X', 'Y', 'Z', 'Q', 'W', 'E', 'R'];
    refillRack(rack, bag);
    expect(rack).toHaveLength(RACK_SIZE);
    expect(bag).toHaveLength(2);
  });
});

// --- createGame ------------------------------------------------------------

describe('Qlashword: createGame', () => {
  it('deals two 7-tile racks and leaves 86 in the bag', () => {
    const g = createGame();
    expect(g.racks[0]).toHaveLength(RACK_SIZE);
    expect(g.racks[1]).toHaveLength(RACK_SIZE);
    expect(g.bag).toHaveLength(100 - 2 * RACK_SIZE);
    expect(g.scores).toEqual([0, 0]);
    expect(g.currentPlayerIdx).toBe(0);
  });

  it('accepts an injected bag for determinism', () => {
    const bag = createBag(); // canonical order
    const g = createGame({ bag });
    // racks drawn off the end; bag untouched original stays intact
    expect(g.bag.length).toBe(100 - 2 * RACK_SIZE);
  });
});

// --- board layout ----------------------------------------------------------

describe('Qlashword: board layout', () => {
  it('center is a double-word square', () => {
    expect(BOARD_BONUS[CENTER][CENTER]).toBe('DW');
  });

  it('corners are triple-word squares', () => {
    expect(BOARD_BONUS[0][0]).toBe('TW');
    expect(BOARD_BONUS[0][14]).toBe('TW');
    expect(BOARD_BONUS[14][0]).toBe('TW');
    expect(BOARD_BONUS[14][14]).toBe('TW');
  });

  it('is symmetric', () => {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        expect(BOARD_BONUS[r][c]).toBe(BOARD_BONUS[14 - r][14 - c]);
      }
    }
  });
});

// --- validatePlacement -----------------------------------------------------

describe('Qlashword: validatePlacement', () => {
  it('rejects an empty placement', () => {
    expect(validatePlacement(emptyBoard(), []).ok).toBe(false);
  });

  it('requires the first move to cover the center', () => {
    const off = validatePlacement(emptyBoard(), hPlace(0, 0, 'CAT'));
    expect(off.ok).toBe(false);
    const on = validatePlacement(emptyBoard(), hPlace(CENTER, CENTER, 'CAT'));
    expect(on.ok).toBe(true);
    expect(on.orientation).toBe('H');
  });

  it('detects vertical orientation', () => {
    const res = validatePlacement(emptyBoard(), vPlace(CENTER, CENTER, 'CAT'));
    expect(res.ok).toBe(true);
    expect(res.orientation).toBe('V');
  });

  it('rejects diagonal / scattered tiles', () => {
    const p = [
      { row: 7, col: 7, letter: 'C', blank: false },
      { row: 8, col: 8, letter: 'A', blank: false },
    ];
    expect(validatePlacement(emptyBoard(), p).ok).toBe(false);
  });

  it('rejects placing on an occupied cell', () => {
    const board = withCells(emptyBoard(), [[7, 7, 'X']]);
    const res = validatePlacement(board, hPlace(7, 7, 'CAT'));
    expect(res.ok).toBe(false);
  });

  it('rejects a gap not filled by an existing tile', () => {
    const p = [
      { row: 7, col: 7, letter: 'C', blank: false },
      { row: 7, col: 9, letter: 'T', blank: false }, // gap at col 8
    ];
    expect(validatePlacement(emptyBoard(), p).ok).toBe(false);
  });

  it('allows a gap that an existing tile fills', () => {
    const board = withCells(emptyBoard(), [[7, 8, 'A']]);
    const p = [
      { row: 7, col: 7, letter: 'C', blank: false },
      { row: 7, col: 9, letter: 'T', blank: false },
    ];
    expect(validatePlacement(board, p).ok).toBe(true);
  });

  it('requires later moves to connect to an existing tile', () => {
    const board = withCells(emptyBoard(), [[7, 7, 'C']]);
    const disconnected = validatePlacement(board, hPlace(0, 0, 'AT'));
    expect(disconnected.ok).toBe(false);
    // a tile placed directly below the existing one connects
    const adjacent = validatePlacement(board, [{ row: 8, col: 7, letter: 'A', blank: false }]);
    expect(adjacent.ok).toBe(true);
  });
});

// --- collectWords ----------------------------------------------------------

describe('Qlashword: collectWords', () => {
  it('reads the main horizontal word', () => {
    const placement = hPlace(7, 7, 'CAT');
    const words = collectWords(emptyBoard(), placement, 'H');
    expect(words).toHaveLength(1);
    expect(words[0].word).toBe('CAT');
    expect(words[0].tiles.every((t) => t.isNew)).toBe(true);
  });

  it('reads a cross-word formed against an existing tile', () => {
    // Existing vertical "AT" at (7,7),(8,7); play "C" at (6,7) → "CAT" (the 1-letter cross is ignored)
    const board = withCells(emptyBoard(), [
      [7, 7, 'A'],
      [8, 7, 'T'],
    ]);
    const placement = [{ row: 6, col: 7, letter: 'C', blank: false }];
    const words = collectWords(board, placement, 'V');
    expect(words.map((w) => w.word)).toContain('CAT');
  });

  it('captures both the main word and a perpendicular cross-word', () => {
    // Existing "S" at (8,8); play "CAT" at row 7 → the "A" above S also forms vertical "AS"
    const board = withCells(emptyBoard(), [[8, 8, 'S']]);
    const placement = [
      { row: 7, col: 7, letter: 'C', blank: false },
      { row: 7, col: 8, letter: 'A', blank: false },
      { row: 7, col: 9, letter: 'T', blank: false },
    ];
    const words = collectWords(board, placement, 'H');
    const wordStrings = words.map((w) => w.word);
    expect(wordStrings).toContain('CAT');
    expect(wordStrings).toContain('AS');
  });

  it('allWordsValid checks every formed word against the dict', () => {
    const valid = [
      { word: 'CAT', tiles: [] },
      { word: 'AS', tiles: [] },
    ];
    const invalid = [
      { word: 'CAT', tiles: [] },
      { word: 'ZZ', tiles: [] },
    ];
    expect(allWordsValid(valid, DICT)).toBe(true);
    expect(allWordsValid(invalid, DICT)).toBe(false);
  });
});

// --- planBonusQuestions ----------------------------------------------------

describe('Qlashword: planBonusQuestions', () => {
  it('emits one question per premium square a new tile covers', () => {
    // center (7,7) DW + first-move tiles. CAT across center cols 7-9.
    const placement = hPlace(7, 7, 'CAT');
    const qs = planBonusQuestions(placement);
    // (7,7) is DW; (7,8),(7,9) are normal → exactly 1 premium
    expect(qs).toHaveLength(1);
    expect(qs[0]).toMatchObject({ row: 7, col: 7, bonusType: 'DW' });
  });

  it('emits nothing when no new tile lands on a premium', () => {
    const placement = hPlace(6, 3, 'AT'); // (6,3) and (6,4) are normal squares
    expect(planBonusQuestions(placement)).toHaveLength(0);
  });
});

// --- scoreTurn -------------------------------------------------------------

describe('Qlashword: scoreTurn', () => {
  // QUIZ = Q10 U1 I1 Z10 = 22 base
  const quizWord = () => ({
    word: 'QUIZ',
    tiles: [
      { row: 7, col: 7, letter: 'Q', blank: false, isNew: true },
      { row: 7, col: 8, letter: 'U', blank: false, isNew: true },
      { row: 7, col: 9, letter: 'I', blank: false, isNew: true },
      { row: 7, col: 10, letter: 'Z', blank: false, isNew: true },
    ],
  });

  it('center DW word: correct answer doubles, wrong leaves base', () => {
    // (7,7) is DW. Q sits there.
    const correct = scoreTurn([quizWord()], { [coordKey(7, 7)]: true }, 4);
    expect(correct.total).toBe(22 * 2);
    const wrong = scoreTurn([quizWord()], {}, 4);
    expect(wrong.total).toBe(22);
  });

  it('only NEW tiles trigger premiums', () => {
    const word = quizWord();
    word.tiles[0].isNew = false; // Q was already on the board → no DW
    const res = scoreTurn([word], { [coordKey(7, 7)]: true }, 1);
    expect(res.total).toBe(22);
  });

  it('letter premium scales only that letter', () => {
    // Z (value 10) on a TL square (5,5). Build a 2-letter word OX-style at (5,5)-(5,6).
    const word = {
      word: 'ZA',
      tiles: [
        { row: 5, col: 5, letter: 'Z', blank: false, isNew: true }, // (5,5) = TL
        { row: 5, col: 6, letter: 'A', blank: false, isNew: true },
      ],
    };
    expect(BOARD_BONUS[5][5]).toBe('TL');
    const correct = scoreTurn([word], { [coordKey(5, 5)]: true }, 2);
    expect(correct.total).toBe(10 * 3 + 1); // Z tripled + A
    const wrong = scoreTurn([word], {}, 2);
    expect(wrong.total).toBe(10 + 1);
  });

  it('blank tiles score 0 regardless of premium', () => {
    const word = {
      word: 'ZA',
      tiles: [
        { row: 5, col: 5, letter: 'Z', blank: true, isNew: true }, // blank on TL
        { row: 5, col: 6, letter: 'A', blank: false, isNew: true },
      ],
    };
    const res = scoreTurn([word], { [coordKey(5, 5)]: true }, 2);
    expect(res.total).toBe(0 * 3 + 1);
  });

  it('adds the 50-point bingo bonus when all 7 tiles are used', () => {
    const res = scoreTurn([quizWord()], {}, RACK_SIZE);
    expect(res.bingo).toBe(true);
    expect(res.total).toBe(22 + BINGO_BONUS);
  });

  it('does not add the bingo bonus for fewer than 7 tiles', () => {
    const res = scoreTurn([quizWord()], {}, 4);
    expect(res.bingo).toBe(false);
  });

  it('sums multiple formed words', () => {
    const w1 = {
      word: 'AT',
      tiles: [
        { row: 6, col: 7, letter: 'A', blank: false, isNew: true },
        { row: 6, col: 8, letter: 'T', blank: false, isNew: true },
      ],
    };
    const w2 = {
      word: 'IT',
      tiles: [
        { row: 6, col: 7, letter: 'I', blank: false, isNew: false },
        { row: 7, col: 7, letter: 'T', blank: false, isNew: true },
      ],
    };
    const res = scoreTurn([w1, w2], {}, 3);
    expect(res.total).toBe(2 + 2); // AT=1+1, IT=1+1, no premiums unlocked
    expect(res.words).toHaveLength(2);
  });
});

// --- turn application ------------------------------------------------------

describe('Qlashword: removeTilesFromRack', () => {
  it('consumes placed letters from the rack', () => {
    const rack = ['C', 'A', 'T', 'X', 'Y', 'Z', 'Q'];
    const ok = removeTilesFromRack(rack, hPlace(7, 7, 'CAT'));
    expect(ok).toBe(true);
    expect(rack.sort()).toEqual(['Q', 'X', 'Y', 'Z']);
  });

  it('consumes a blank for a blank-flagged tile', () => {
    const rack = ['_', 'A'];
    const ok = removeTilesFromRack(rack, [{ row: 7, col: 7, letter: 'Z', blank: true }]);
    expect(ok).toBe(true);
    expect(rack).toEqual(['A']);
  });

  it('fails and leaves the rack intact when a tile is missing', () => {
    const rack = ['C', 'A'];
    const ok = removeTilesFromRack(rack, hPlace(7, 7, 'CAT'));
    expect(ok).toBe(false);
    expect(rack).toEqual(['C', 'A']);
  });
});

describe('Qlashword: applyTurn', () => {
  function gameWithRack(rack) {
    const g = createGame({ bag: createBag() });
    g.racks[0] = rack;
    return g;
  }

  it('places tiles, scores, consumes rack, refills, and hands off', () => {
    const g = gameWithRack(['C', 'A', 'T', 'X', 'Y', 'Z', 'Q']);
    const placement = hPlace(CENTER, CENTER, 'CAT'); // covers center DW at (7,7)
    const words = collectWords(g.board, placement, 'H');
    const res = applyTurn(g, 0, placement, words, {}); // DW not unlocked
    expect('breakdown' in res).toBe(true);
    expect(res.breakdown.total).toBe(5); // CAT = 3+1+1, no premium
    expect(g.scores[0]).toBe(5);
    expect(g.board[7][7]).toEqual({ letter: 'C', blank: false });
    expect(g.racks[0]).toHaveLength(RACK_SIZE); // refilled
    expect(g.currentPlayerIdx).toBe(1);
    expect(g.turnNumber).toBe(2);
  });

  it('unlocked center DW doubles via bonusResults', () => {
    const g = gameWithRack(['C', 'A', 'T', 'X', 'Y', 'Z', 'Q']);
    const placement = hPlace(CENTER, CENTER, 'CAT');
    const words = collectWords(g.board, placement, 'H');
    const res = applyTurn(g, 0, placement, words, { [coordKey(7, 7)]: true });
    expect(res.breakdown.total).toBe(10); // (3+1+1) * 2
  });

  it('rejects when not the player turn', () => {
    const g = gameWithRack(['C', 'A', 'T']);
    const res = applyTurn(g, 1, hPlace(CENTER, CENTER, 'CAT'), [], {});
    expect('error' in res).toBe(true);
  });

  it('rejects a placement the rack cannot cover', () => {
    const g = gameWithRack(['C', 'A']);
    const placement = hPlace(CENTER, CENTER, 'CAT');
    const res = applyTurn(g, 0, placement, [], {});
    expect('error' in res).toBe(true);
    expect(g.currentPlayerIdx).toBe(0); // unchanged
  });
});

describe('Qlashword: passTurn & swapTiles', () => {
  it('passTurn increments the streak and hands off', () => {
    const g = createGame({ bag: createBag() });
    passTurn(g, 0);
    expect(g.passStreak).toBe(1);
    expect(g.currentPlayerIdx).toBe(1);
  });

  it('swapTiles exchanges tiles, resets pass streak, hands off', () => {
    const g = createGame({ bag: createBag() });
    g.passStreak = 2;
    const before = g.racks[0].slice();
    const bagBefore = g.bag.length;
    const res = swapTiles(g, 0, [0, 1]);
    expect('ok' in res).toBe(true);
    expect(g.racks[0]).toHaveLength(RACK_SIZE);
    expect(g.bag.length).toBe(bagBefore); // 2 out, 2 in
    expect(g.passStreak).toBe(0);
    expect(g.currentPlayerIdx).toBe(1);
    expect(g.racks[0]).not.toEqual(before);
  });

  it('swapTiles rejects when the bag is too small', () => {
    const g = createGame({ bag: createBag() });
    g.bag = ['A'];
    const res = swapTiles(g, 0, [0, 1]);
    expect('error' in res).toBe(true);
  });
});

// --- checkGameOver / finalScores -------------------------------------------

describe('Qlashword: game over & final scoring', () => {
  it('ends when bag empty and a rack empty', () => {
    const g = createGame();
    g.bag = [];
    g.racks = [[], ['A', 'B']];
    expect(checkGameOver(g)).toBe(true);
  });

  it('ends after both players pass twice in a row', () => {
    const g = createGame();
    g.passStreak = 4;
    expect(checkGameOver(g)).toBe(true);
  });

  it('does not end mid-game', () => {
    expect(checkGameOver(createGame())).toBe(false);
  });

  it('rackValue sums leftover tile values', () => {
    expect(rackValue(['Q', 'A'])).toBe(11); // 10 + 1
    expect(rackValue(['_', 'A'])).toBe(1); // blank = 0
  });

  it('finalScores subtracts leftovers and credits the emptied rack', () => {
    const g = createGame();
    g.bag = [];
    g.scores = [100, 80];
    g.racks = [[], ['Q', 'A']]; // p0 emptied, p1 holds 11 pts
    const [s0, s1] = finalScores(g);
    expect(s0).toBe(100 + 11); // p0 gains opponent leftover
    expect(s1).toBe(80 - 11); // p1 loses own leftover
  });
});
