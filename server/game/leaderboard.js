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
  const stmt = db.prepare(`
    SELECT id, name, answers, time_ms, created_at
    FROM leaderboard
    ORDER BY answers DESC, time_ms ASC
    LIMIT 10
  `);
  return stmt.all();
}

export function insertScore(name, answers, timeMs) {
  const stmt = db.prepare(`
    INSERT INTO leaderboard (name, answers, time_ms, created_at)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(name, answers, timeMs, Date.now());
  return getTop10();
}

export function checkQualifiesTop10(answers, timeMs) {
  const top10 = getTop10();
  if (top10.length < 10) {return true;}
  const wouldPlace = top10.findIndex(e => answers > e.answers || (answers === e.answers && timeMs < e.time_ms));
  return wouldPlace !== -1;
}
