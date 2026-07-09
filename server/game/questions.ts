// Loads questions.enc, decrypts them, and builds a _byId index for O(1) lookup.

import fs from 'fs';
import path from 'path';
import type { Category } from './engine.ts';

// Local types mirroring engine.ts to avoid ts-node import issues.
interface Question {
  id: string;
  a: number; // correct answer index
  category: string;
  points: number;
  penalty: number;
}

interface QuestionsDb {
  [category: string]: Question[] | Record<string, Question> | undefined;
  _byId?: Record<string, Question>;
}

// KEY is lazy-loaded on first use to ensure dotenv has been configured
let KEY: Buffer | null = null;

function getKey(): Buffer {
  if (!KEY) {
    const questionsKey = process.env.QUESTIONS_KEY;
    if (!questionsKey) {
      throw new Error('QUESTIONS_KEY environment variable is not set');
    }
    KEY = Buffer.from(questionsKey, 'utf8');
  }
  return KEY;
}

function decrypt(base64: string): string {
  const enc = Buffer.from(base64, 'base64');
  const dec = Buffer.alloc(enc.length);
  const key = getKey();
  for (let i = 0; i < enc.length; i++) {
    dec[i] = enc[i] ^ key[i % key.length];
  }
  return dec.toString('utf8');
}

export function loadQuestions(encPath?: string): QuestionsDb {
  const resolved =
    encPath || process.env.QUESTIONS_PATH || path.resolve(import.meta.dirname, '../questions.enc');

  let raw: string;
  try {
    raw = fs.readFileSync(resolved, 'utf8');
  } catch (err) {
    throw new Error(
      `questions.enc not found at ${resolved}. ` +
        'Set QUESTIONS_PATH env var or place file in server/questions.enc: ' +
        (err as Error).message,
      { cause: err },
    );
  }
  const data = JSON.parse(decrypt(raw)) as QuestionsDb;

  // Build O(1) id lookup (include category for client display)
  data._byId = {};
  for (const [cat, qs] of Object.entries(data)) {
    if (!Array.isArray(qs)) {
      continue;
    }
    for (const q of qs) {
      if (q.id) {
        data._byId[q.id] = { ...q, category: cat as Category };
      }
    }
  }

  const total = (Object.values(data) as Question[][])
    .filter(Array.isArray)
    .reduce((n, qs) => n + qs.length, 0);

  console.log(`[questions] loaded ${total} questions`);
  return data;
}

// Lazy flat array, WeakMap-cached per db (avoids the OOM an eager _all[] caused). Each item gets its `category` from the bucket key since db[cat] arrays don't carry it.
const _allCacheByDb = new WeakMap<QuestionsDb, Question[]>();
export function getAllQuestions(db: QuestionsDb): Question[] {
  if (!_allCacheByDb.has(db)) {
    const flat: Question[] = [];
    for (const [cat, qs] of Object.entries(db)) {
      if (!Array.isArray(qs)) {
        continue;
      }
      for (const q of qs) {
        if (q.id !== undefined) {
          flat.push({ ...q, category: cat as Category });
        }
      }
    }
    _allCacheByDb.set(db, flat);
  }
  return _allCacheByDb.get(db)!;
}

// Filtered pool for a specific set of categories. Cached per db+category key.
const _catCacheByDb = new WeakMap<QuestionsDb, Map<string, Question[]>>();
export function getQuestionsForCategories(db: QuestionsDb, categories: Category[]): Question[] {
  const key = categories.slice().sort().join(',');
  let dbCache = _catCacheByDb.get(db);
  if (!dbCache) {
    dbCache = new Map();
    _catCacheByDb.set(db, dbCache);
  }
  if (!dbCache.has(key)) {
    dbCache.set(
      key,
      categories.flatMap((cat) =>
        Array.isArray(db[cat]) ? db[cat].filter((q): q is Question => q.id !== undefined) : [],
      ),
    );
  }
  return dbCache.get(key)!;
}

// Shared fetch primitive: one random question from the enabled pool, skipping excludeIds (falls back to full pool if exclude empties it). Enabled pool is WeakMap-cached by the enabledCats Set ref.
const _enabledPoolByDb = new WeakMap<QuestionsDb, WeakMap<Set<string>, Question[]>>();
function _getEnabledPool(db: QuestionsDb, enabledCats: Set<string>): Question[] {
  let perDb = _enabledPoolByDb.get(db);
  if (!perDb) {
    perDb = new WeakMap();
    _enabledPoolByDb.set(db, perDb);
  }
  let pool = perDb.get(enabledCats);
  if (!pool) {
    pool = getAllQuestions(db).filter((q) => enabledCats.has(q.category));
    perDb.set(enabledCats, pool);
  }
  return pool;
}

export function pickRandomQuestion(
  db: QuestionsDb,
  enabledCats: Set<string>,
  excludeIds?: Set<string>,
): Question | null {
  const pool = _getEnabledPool(db, enabledCats);
  if (!pool.length) {
    return null;
  }
  const src =
    excludeIds && excludeIds.size > 0
      ? (() => {
          const avail = pool.filter((q) => !excludeIds.has(q.id));
          return avail.length > 0 ? avail : pool;
        })()
      : pool;
  return src[Math.floor(Math.random() * src.length)];
}
