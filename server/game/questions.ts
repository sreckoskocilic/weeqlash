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

const _allCacheByDb = new WeakMap<QuestionsDb, Question[]>();
export function getAllQuestions(db: QuestionsDb): Question[] {
  if (!_allCacheByDb.has(db)) {
    _allCacheByDb.set(db, db._byId ? Object.values(db._byId) : []);
  }
  return _allCacheByDb.get(db)!;
}

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
  let q = pool[Math.floor(Math.random() * pool.length)];
  for (let i = 0; i < 100 && excludeIds?.has(q.id); i++) {
    q = pool[Math.floor(Math.random() * pool.length)];
  }
  return q;
}
