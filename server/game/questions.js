// Loads questions.enc, decrypts them, and builds a _byId index for O(1) lookup.

import fs from 'fs';
import path from 'path';

const KEY = Buffer.from(process.env.QUESTIONS_KEY, 'utf8');

function decrypt(base64) {
  const enc = Buffer.from(base64, 'base64');
  const dec = Buffer.alloc(enc.length);
  for (let i = 0; i < enc.length; i++) {
    dec[i] = enc[i] ^ KEY[i % KEY.length];
  }
  return dec.toString('utf8');
}

export function loadQuestions(encPath) {
  const resolved =
    encPath || process.env.QUESTIONS_PATH || path.resolve(import.meta.dirname, '../questions.enc');

  let raw;
  try {
    raw = fs.readFileSync(resolved, 'utf8');
  } catch (err) {
    throw new Error(
      `questions.enc not found at ${resolved}. ` +
        'Set QUESTIONS_PATH env var or place file in server/questions.enc: ' +
        err.message,
    );
  }
  const data = JSON.parse(decrypt(raw));

  // Build O(1) id lookup (include category for client display)
  data._byId = {};
  for (const [cat, qs] of Object.entries(data)) {
    if (!Array.isArray(qs)) {
      continue;
    }
    for (const q of qs) {
      if (q.id) {
        data._byId[q.id] = { ...q, category: cat };
      }
    }
  }

  const total = Object.values(data)
    .filter(Array.isArray)
    .reduce((n, qs) => n + qs.length, 0);

  console.log(`[questions] loaded ${total} questions`);
  return data;
}

// Lazy flat array for quiz mode — computed once per db object on first access, not at startup.
// Avoids the OOM crash that eager _all[] caused with 8642 questions.
// WeakMap keyed on db object so tests that call loadQuestions() per-test get a fresh cache.
const _allCacheByDb = new WeakMap();
export function getAllQuestions(db) {
  if (!_allCacheByDb.has(db)) {
    _allCacheByDb.set(
      db,
      Object.values(db)
        .filter(Array.isArray)
        .flat()
        .filter((q) => q.id),
    );
  }
  return _allCacheByDb.get(db);
}

// Filtered pool for a specific set of categories. Cached per db+category key.
const _catCacheByDb = new Map();
export function getQuestionsForCategories(db, categories) {
  const key = categories.slice().sort().join(',');
  if (!_catCacheByDb.has(db)) {
    _catCacheByDb.set(db, new Map());
  }
  const dbCache = _catCacheByDb.get(db);
  if (!dbCache.has(key)) {
    dbCache.set(
      key,
      categories.flatMap((cat) => (Array.isArray(db[cat]) ? db[cat].filter((q) => q.id) : [])),
    );
  }
  return dbCache.get(key);
}
