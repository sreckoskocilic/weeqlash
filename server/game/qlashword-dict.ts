// Loads the Qlashword word list into a Set for O(1) validity lookup. I/O lives
// here so qlashword.ts stays pure (it takes the dict Set as an argument).
//
// Default list is TWL06 (~178k North-American tournament words), shipped at
// server/twl06.txt. Override the path with QLASHWORD_DICT_PATH (e.g. to swap in
// SOWPODS). Only A–Z words of length 2–15 are kept (2 = shortest legal play,
// 15 = board width); anything else in the file is dropped as junk.

import fs from 'fs';
import path from 'path';

const WORD_RE = /^[A-Z]{2,15}$/;

let _dict: Set<string> | null = null;

export function loadDictionary(dictPath?: string): Set<string> {
  const resolved =
    dictPath ||
    process.env.QLASHWORD_DICT_PATH ||
    path.resolve(import.meta.dirname, '../twl06.txt');

  let raw: string;
  try {
    raw = fs.readFileSync(resolved, 'utf8');
  } catch (err) {
    throw new Error(
      `Qlashword dictionary not found at ${resolved}. ` +
        'Set QLASHWORD_DICT_PATH or place the word list at server/twl06.txt: ' +
        (err as Error).message,
      { cause: err },
    );
  }

  const dict = new Set<string>();
  for (const line of raw.split('\n')) {
    const word = line.trim().toUpperCase();
    if (WORD_RE.test(word)) {
      dict.add(word);
    }
  }

  console.log(`[qlashword-dict] loaded ${dict.size} words`);
  return dict;
}

// Process-wide cached dictionary (the word list never changes at runtime).
export function getDictionary(): Set<string> {
  if (!_dict) {
    _dict = loadDictionary();
  }
  return _dict;
}

// True iff `word` is a legal Qlashword play. Case-insensitive.
export function isWord(word: string, dict: Set<string> = getDictionary()): boolean {
  return dict.has(word.toUpperCase());
}
