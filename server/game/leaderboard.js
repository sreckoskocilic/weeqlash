import Database from 'better-sqlite3';
import path from 'path';
import { QUIZ_MODES, QUIZ_MODES_BY_ID } from './quiz-modes.js';

const dbPath = process.env.DB_PATH || path.resolve(import.meta.dirname, '../data/leaderboard.db');

let db;

const ALLOWED_TABLES = new Set(QUIZ_MODES.map((m) => m.table));

function assertTable(table) {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`Unknown leaderboard table: ${table}`);
  }
}

export function getDb() {
  return db;
}

export function initDb() {
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

export function getTop10ForTable(table) {
  assertTable(table);
  try {
    return db
      .prepare(
        `SELECT id, name, answers, time_ms, created_at FROM ${table} ORDER BY answers DESC, time_ms ASC LIMIT 10`,
      )
      .all();
  } catch (err) {
    console.error(`[leaderboard] getTop10ForTable(${table}) failed:`, err.message);
    return [];
  }
}

export function insertScoreForTable(table, name, answers, timeMs) {
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
  try {
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

export function clearTestEntries(table) {
  assertTable(table);
  try {
    // Delete entries with names prefixed 'e2e_' (created by e2e tests)
    db.prepare(`DELETE FROM ${table} WHERE name LIKE 'e2e_%'`).run();
  } catch (err) {
    console.error(`[leaderboard] clearTestEntries(${table}) failed:`, err.message);
  }
}

export function checkQualifiesTop10ForTable(table, answers, timeMs) {
  assertTable(table);
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

export function pruneTable(table) {
  assertTable(table);
  try {
    db.prepare(
      `DELETE FROM ${table} WHERE id NOT IN (SELECT id FROM ${table} ORDER BY answers DESC, time_ms ASC LIMIT 100)`,
    ).run();
  } catch (err) {
    console.error(`[leaderboard] pruneTable(${table}) failed:`, err.message);
  }
}

export function pruneAllModes() {
  for (const mode of QUIZ_MODES) {
    pruneTable(mode.table);
  }
}

// --- Mode-based convenience wrappers ---

export function getTop10ForMode(modeId) {
  const mode = QUIZ_MODES_BY_ID[modeId];
  if (!mode) {
    return [];
  }
  return getTop10ForTable(mode.table);
}

export function insertScoreForMode(modeId, name, answers, timeMs) {
  const mode = QUIZ_MODES_BY_ID[modeId];
  if (!mode) {
    return [];
  }
  return insertScoreForTable(mode.table, name, answers, timeMs);
}

export function checkQualifiesTop10ForMode(modeId, answers, timeMs) {
  const mode = QUIZ_MODES_BY_ID[modeId];
  if (!mode) {
    return false;
  }
  return checkQualifiesTop10ForTable(mode.table, answers, timeMs);
}
