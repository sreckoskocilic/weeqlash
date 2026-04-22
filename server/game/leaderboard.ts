import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { QUIZ_MODES, QUIZ_MODES_BY_ID } from './quiz-modes.ts';

const dbPath = process.env.DB_PATH || path.resolve(import.meta.dirname, '../data/leaderboard.db');

// Ensure data directory exists
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db: Database.Database | null = null;

const ALLOWED_TABLES = new Set(QUIZ_MODES.map((m) => m.table));

function assertTable(table: string): void {
  if (!ALLOWED_TABLES.has(table)) {
    console.error('[leaderboard] Attempted access to invalid table:', table);
    throw new Error(`Unknown leaderboard table: ${table}`);
  }
  // Additional security: ensure table name is alphanumeric with underscores
  if (!/^[a-zA-Z0-9_]+$/.test(table)) {
    console.error('[leaderboard] Invalid table name:', table);
    throw new Error(`Invalid table name: ${table}`);
  }
}

// Leaderboard entry structure
export interface LeaderboardEntry {
  id: number;
  name: string;
  answers: number;
  time_ms: number;
  created_at: number;
}

// Quiz mode structure (matching quiz-modes.js)
export interface QuizMode {
  id: string;
  label: string;
  categories: string[] | null;
  table: string;
}

export function getDb(): Database.Database | null {
  return db;
}

export function initDb(): void {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  for (const mode of QUIZ_MODES) {
    const exists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='${mode.table}'`)
      .get();
    if (!exists) {
      db.exec(`
        CREATE TABLE ${mode.table} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          answers INTEGER NOT NULL,
          time_ms INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_${mode.table}_answers_time ON ${mode.table}(answers DESC, time_ms ASC);
      `);
      console.log(`[leaderboard] table '${mode.table}' initialized`);
    }
  }
}

// --- Generic table operations ---

export function getTop10ForTable(table: string): LeaderboardEntry[] {
  assertTable(table);
  // Table existence validated by assertTable + initDb creates all tables on startup
  if (!db) {
    throw new Error('Database not initialized');
  }
  try {
    return db
      .prepare(
        `SELECT id, name, answers, time_ms, created_at FROM ${table} ORDER BY answers DESC, time_ms ASC LIMIT 10`,
      )
      .all() as LeaderboardEntry[];
  } catch (err) {
    console.error(`[leaderboard] getTop10ForTable(${table}) failed:`, err.message);
    return [];
  }
}

export function insertScoreForTable(
  table: string,
  name: string,
  answers: number,
  timeMs: number,
): LeaderboardEntry[] {
  assertTable(table);
  if (
    !name ||
    name.length > 16 ||
    typeof answers !== 'number' ||
    answers < 0 ||
    typeof timeMs !== 'number'
  ) {
    return [];
  }
  if (!db) {
    throw new Error('Database not initialized');
  }
  try {
    // Use parameterized query to prevent SQL injection
    db.prepare(`INSERT INTO ${table} (name, answers, time_ms, created_at) VALUES (?, ?, ?, ?)`).run(
      name,
      answers,
      timeMs,
      Date.now(),
    );
    return getTop10ForTable(table);
  } catch (err) {
    console.error(`[leaderboard] insertScoreForTable(${table}) failed:`, err.message);
    return [];
  }
}

export function clearTestEntries(table: string): void {
  assertTable(table);
  if (!db) {
    throw new Error('Database not initialized');
  }
  try {
    // Delete entries with names prefixed 'e2e_' (created by e2e tests)
    db.prepare(`DELETE FROM ${table} WHERE name LIKE 'e2e_%'`).run();
  } catch (err) {
    console.error(`[leaderboard] clearTestEntries(${table}) failed:`, err.message);
  }
}

export function checkQualifiesTop10ForTable(
  table: string,
  answers: number,
  timeMs: number,
): boolean {
  assertTable(table);
  if (!db) {
    throw new Error('Database not initialized');
  }
  try {
    const better = db
      .prepare(
        `SELECT COUNT(*) as cnt FROM ${table} WHERE answers > ? OR (answers = ? AND time_ms < ?)`,
      )
      .get(answers, answers, timeMs);
    return better.cnt < 10;
  } catch (err) {
    console.error(`[leaderboard] checkQualifiesTop10ForTable(${table}) failed:`, err.message);
    return false;
  }
}

export function pruneTable(table: string): void {
  assertTable(table);
  if (!db) {
    throw new Error('Database not initialized');
  }
  try {
    db.prepare(
      `DELETE FROM ${table} WHERE id NOT IN (SELECT id FROM ${table} ORDER BY answers DESC, time_ms ASC LIMIT 100)`,
    ).run();
  } catch (err) {
    console.error(`[leaderboard] pruneTable(${table}) failed:`, err.message);
  }
}

export function pruneAllModes(): void {
  for (const mode of QUIZ_MODES) {
    pruneTable(mode.table);
  }
}

// --- Mode-based convenience wrappers ---

export function getTop10ForMode(modeId: string): LeaderboardEntry[] {
  const mode = QUIZ_MODES_BY_ID[modeId];
  if (!mode) {
    return [];
  }
  return getTop10ForTable(mode.table);
}

export function insertScoreForMode(
  modeId: string,
  name: string,
  answers: number,
  timeMs: number,
): LeaderboardEntry[] {
  const mode = QUIZ_MODES_BY_ID[modeId];
  if (!mode) {
    return [];
  }
  return insertScoreForTable(mode.table, name, answers, timeMs);
}

export function checkQualifiesTop10ForMode(
  modeId: string,
  answers: number,
  timeMs: number,
): boolean {
  const mode = QUIZ_MODES_BY_ID[modeId];
  if (!mode) {
    return false;
  }
  return checkQualifiesTop10ForTable(mode.table, answers, timeMs);
}
