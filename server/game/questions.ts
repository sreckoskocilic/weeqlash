// Loads questions.enc, decrypts them, and builds a _byId index for O(1) lookup.

import fs from 'fs';
import path from 'path';
import type { Category } from './engine.ts';

// Local type definitions matching those in engine.ts to avoid ts-node import issues
interface Question {
  id: string;
  a: number; // correct answer index
  category: string;
  points: number;
  penalty: number;
  // other fields like question, options, etc. are ignored by engine
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

// Lazy flat array for quiz mode — computed once per db object on first access, not at startup.
// Avoids the OOM crash that eager _all[] caused with 8642 questions.
// WeakMap keyed on db object so tests that call loadQuestions() per-test get a fresh cache.
const _allCacheByDb = new WeakMap<QuestionsDb, Question[]>();
export function getAllQuestions(db: QuestionsDb): Question[] {
  if (!_allCacheByDb.has(db)) {
    _allCacheByDb.set(
      db,
      Object.values(db)
        .filter(Array.isArray)
        .flat()
        .filter((q): q is Question => q.id !== undefined),
    );
  }
  return _allCacheByDb.get(db)!;
}

// Filtered pool for a specific set of categories. Cached per db+category key.
const _catCacheByDb = new Map<QuestionsDb, Map<string, Question[]>>();
export function getQuestionsForCategories(db: QuestionsDb, categories: Category[]): Question[] {
  const key = categories.slice().sort().join(',');
  if (!_catCacheByDb.has(db)) {
    _catCacheByDb.set(db, new Map());
  }
  const dbCache = _catCacheByDb.get(db)!;
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
