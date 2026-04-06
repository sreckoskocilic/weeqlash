import Database from 'better-sqlite3';
import path from 'path';

const dbPath = process.env.DB_PATH || path.resolve(import.meta.dirname, '../data/leaderboard.db');

let db;

export function initDb() {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  const tableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='leaderboard'"
  ).get();

  if (!tableExists) {
    db.exec(`
      CREATE TABLE leaderboard (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        answers INTEGER NOT NULL,
        time_ms INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_answers_time ON leaderboard(answers DESC, time_ms ASC);
    `);
    console.log('[leaderboard] DB initialized');
  }
}

export function getTop10() {
  try {
    const stmt = db.prepare(`
      SELECT id, name, answers, time_ms, created_at
      FROM leaderboard
      ORDER BY answers DESC, time_ms ASC
      LIMIT 10
    `);
    return stmt.all();
  } catch (err) {
    console.error('[leaderboard] getTop10 failed:', err.message);
    return [];
  }
}

export function insertScore(name, answers, timeMs) {
  if (!name || name.length > 16 || typeof answers !== 'number' || answers < 0 || typeof timeMs !== 'number') {
    return [];
  }
  try {
    const stmt = db.prepare(`
      INSERT INTO leaderboard (name, answers, time_ms, created_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(name, answers, timeMs, Date.now());
    return getTop10();
  } catch (err) {
    console.error('[leaderboard] insertScore failed:', err.message);
    return [];
  }
}

export function checkQualifiesTop10(answers, timeMs) {
  try {
    // Single query: count entries better than this score.
    // If fewer than 10 are better, the new score qualifies for top 10.
    const better = db.prepare(
      'SELECT COUNT(*) as cnt FROM leaderboard WHERE answers > ? OR (answers = ? AND time_ms < ?)'
    ).get(answers, answers, timeMs);

    return better.cnt < 10;
  } catch (err) {
    console.error('[leaderboard] checkQualifiesTop10 failed:', err.message);
    return false;
  }
}

// Prune entries beyond the top 100 to prevent unbounded DB growth.
// Keeps a buffer above the top 10 so new scores can still qualify.
export function pruneLeaderboard() {
  try {
    db.prepare('DELETE FROM leaderboard WHERE id NOT IN (SELECT id FROM leaderboard ORDER BY answers DESC, time_ms ASC LIMIT 100)').run();
  } catch (err) {
    console.error('[leaderboard] pruneLeaderboard failed:', err.message);
  }
}
