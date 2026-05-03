import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { QUIZ_MODES } from './quiz-modes.ts';
import { runMigrations } from './migrations.ts';

const dbPath = process.env.DB_PATH || path.resolve(import.meta.dirname, '../data/leaderboard.db');

const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db: Database.Database | null = null;
const _modeIdBySlug = new Map<string, number>();

export interface LeaderboardEntry {
  id: number;
  name: string;
  answers: number;
  time_ms: number;
  created_at: number;
}

export interface QuizMode {
  id: string;
  label: string;
  categories: string[] | null;
}

export function getDb(): Database.Database | null {
  return db;
}

export function initDb(): void {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Mode registry. Created before leaderboard so the FK can resolve on fresh DBs.
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_modes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
  `);

  // Seed game_modes from QUIZ_MODES (idempotent). Runs before migrations so
  // 002_normalize_leaderboard_with_game_modes can resolve the triviandom row.
  const seedStmt = db.prepare(
    'INSERT OR IGNORE INTO game_modes (slug, label, created_at) VALUES (?, ?, ?)',
  );
  const now = Date.now();
  for (const mode of QUIZ_MODES) {
    seedStmt.run(mode.id, mode.label, now);
  }

  // Fresh-DB shape. Existing prod DBs created leaderboard without mode_id; the
  // 002 migration recreates them. CREATE IF NOT EXISTS is idempotent for both.
  db.exec(`
    CREATE TABLE IF NOT EXISTS leaderboard (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      answers INTEGER NOT NULL,
      time_ms INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      mode_id INTEGER REFERENCES game_modes(id)
    );
  `);

  runMigrations(db);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_leaderboard_mode_score
      ON leaderboard(mode_id, answers DESC, time_ms ASC);
  `);

  // Cache slug → id resolution. Populated post-migration so any seed inserted
  // by migrations is also available.
  _modeIdBySlug.clear();
  const rows = db.prepare('SELECT id, slug FROM game_modes').all() as {
    id: number;
    slug: string;
  }[];
  for (const row of rows) {
    _modeIdBySlug.set(row.slug, row.id);
  }

  console.log(`[leaderboard] initialized (${_modeIdBySlug.size} modes registered)`);
}

function resolveModeId(modeSlug: string): number | null {
  return _modeIdBySlug.get(modeSlug) ?? null;
}

export function getTop10ForMode(modeId: string): LeaderboardEntry[] {
  if (!db) {
    throw new Error('Database not initialized');
  }
  const dbModeId = resolveModeId(modeId);
  if (dbModeId === null) {
    return [];
  }
  try {
    return db
      .prepare(
        `SELECT id, name, answers, time_ms, created_at FROM leaderboard
         WHERE mode_id = ? ORDER BY answers DESC, time_ms ASC LIMIT 10`,
      )
      .all(dbModeId) as LeaderboardEntry[];
  } catch (err) {
    console.error(`[leaderboard] getTop10ForMode(${modeId}) failed:`, (err as Error).message);
    return [];
  }
}

export function insertScoreForMode(
  modeId: string,
  name: string,
  answers: number,
  timeMs: number,
): LeaderboardEntry[] {
  if (!db) {
    throw new Error('Database not initialized');
  }
  const dbModeId = resolveModeId(modeId);
  if (dbModeId === null) {
    return [];
  }
  if (!name || name.length > 16 || typeof answers !== 'number' || typeof timeMs !== 'number') {
    return [];
  }
  try {
    db.prepare(
      'INSERT INTO leaderboard (name, answers, time_ms, created_at, mode_id) VALUES (?, ?, ?, ?, ?)',
    ).run(name, answers, timeMs, Date.now(), dbModeId);
    return getTop10ForMode(modeId);
  } catch (err) {
    console.error(`[leaderboard] insertScoreForMode(${modeId}) failed:`, (err as Error).message);
    return [];
  }
}

export function checkQualifiesTop10ForMode(
  modeId: string,
  answers: number,
  timeMs: number,
): boolean {
  if (!db) {
    throw new Error('Database not initialized');
  }
  const dbModeId = resolveModeId(modeId);
  if (dbModeId === null) {
    return false;
  }
  try {
    const better = db
      .prepare(
        `SELECT COUNT(*) as cnt FROM leaderboard
         WHERE mode_id = ? AND (answers > ? OR (answers = ? AND time_ms < ?))`,
      )
      .get(dbModeId, answers, answers, timeMs) as { cnt: number } | undefined;
    return better === undefined || better === null ? false : better.cnt < 10;
  } catch (err) {
    console.error(
      `[leaderboard] checkQualifiesTop10ForMode(${modeId}) failed:`,
      (err as Error).message,
    );
    return false;
  }
}

export function clearTestEntries(): void {
  if (!db) {
    throw new Error('Database not initialized');
  }
  try {
    db.prepare('DELETE FROM leaderboard WHERE name LIKE \'e2e_%\'').run();
  } catch (err) {
    console.error('[leaderboard] clearTestEntries() failed:', (err as Error).message);
  }
}

export function pruneMode(modeId: string): void {
  if (!db) {
    throw new Error('Database not initialized');
  }
  const dbModeId = resolveModeId(modeId);
  if (dbModeId === null) {
    return;
  }
  try {
    db.prepare(
      `DELETE FROM leaderboard
       WHERE mode_id = ?
         AND id NOT IN (
           SELECT id FROM leaderboard
           WHERE mode_id = ?
           ORDER BY answers DESC, time_ms ASC
           LIMIT 100
         )`,
    ).run(dbModeId, dbModeId);
  } catch (err) {
    console.error(`[leaderboard] pruneMode(${modeId}) failed:`, (err as Error).message);
  }
}

export function pruneAllModes(): void {
  for (const mode of QUIZ_MODES) {
    pruneMode(mode.id);
  }
}
