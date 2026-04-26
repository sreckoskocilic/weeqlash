import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';

// Mode-shape tests live in tests/quiz-modes.test.js. This file covers the
// unified leaderboard schema (game_modes + leaderboard with mode_id FK).
//
// Integration-style: real file-based DB per test (leaderboard module is a
// singleton, so we exercise raw SQL against the canonical shape).
describe('Leaderboard: Integration Tests', () => {
  let testDbs = [];

  function createTestDb() {
    const dbPath = `/tmp/test-lb-${Date.now()}-${Math.random()}.db`;
    testDbs.push(dbPath);
    return dbPath;
  }

  afterEach(() => {
    for (const dbPath of testDbs) {
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          fs.unlinkSync(dbPath + suffix);
        } catch {
          // file may not exist; ignore
        }
      }
    }
    testDbs = [];
  });

  function createSchema(db) {
    db.exec(`
      CREATE TABLE game_modes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT UNIQUE NOT NULL,
        label TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE leaderboard (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        answers INTEGER NOT NULL,
        time_ms INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        mode_id INTEGER NOT NULL REFERENCES game_modes(id)
      );
      INSERT INTO game_modes (slug, label, created_at) VALUES ('triviandom', 'Triviandom', ${Date.now()});
    `);
  }

  it('creates expected tables', () => {
    const dbPath = createTestDb();
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    createSchema(db);

    for (const tableName of ['game_modes', 'leaderboard']) {
      const result = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}'`)
        .get();
      expect(result).toBeDefined();
    }
    db.close();
  });

  it('inserts and retrieves scores filtered by mode_id', () => {
    const dbPath = createTestDb();
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    createSchema(db);

    const triviaModeId = db.prepare('SELECT id FROM game_modes WHERE slug=\'triviandom\'').get().id;

    db.prepare(
      'INSERT INTO leaderboard (name, answers, time_ms, created_at, mode_id) VALUES (?, ?, ?, ?, ?)',
    ).run('TestPlayer', 10, 5000, Date.now(), triviaModeId);

    const result = db
      .prepare(
        'SELECT * FROM leaderboard WHERE mode_id = ? ORDER BY answers DESC, time_ms ASC LIMIT 10',
      )
      .all(triviaModeId);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('TestPlayer');
    expect(result[0].answers).toBe(10);
    db.close();
  });

  it('orders by answers DESC, time_ms ASC within mode', () => {
    const dbPath = createTestDb();
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    createSchema(db);

    const triviaModeId = db.prepare('SELECT id FROM game_modes WHERE slug=\'triviandom\'').get().id;

    db.prepare(
      'INSERT INTO leaderboard (name, answers, time_ms, created_at, mode_id) VALUES (?, ?, ?, ?, ?)',
    ).run('P1', 5, 5000, Date.now(), triviaModeId);
    db.prepare(
      'INSERT INTO leaderboard (name, answers, time_ms, created_at, mode_id) VALUES (?, ?, ?, ?, ?)',
    ).run('P2', 10, 3000, Date.now(), triviaModeId);
    db.prepare(
      'INSERT INTO leaderboard (name, answers, time_ms, created_at, mode_id) VALUES (?, ?, ?, ?, ?)',
    ).run('P3', 10, 5000, Date.now(), triviaModeId);

    const result = db
      .prepare(
        'SELECT * FROM leaderboard WHERE mode_id = ? ORDER BY answers DESC, time_ms ASC LIMIT 10',
      )
      .all(triviaModeId);
    expect(result[0].name).toBe('P2'); // 10 answers, less time
    expect(result[1].name).toBe('P3'); // 10 answers, more time
    expect(result[2].name).toBe('P1'); // 5 answers
    db.close();
  });

  it('isolates leaderboards across modes', () => {
    const dbPath = createTestDb();
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    createSchema(db);

    db.prepare(
      'INSERT INTO game_modes (slug, label, created_at) VALUES (\'skipnot\', \'SkipNoT\', ?)',
    ).run(Date.now());
    const triviaId = db.prepare('SELECT id FROM game_modes WHERE slug=\'triviandom\'').get().id;
    const skipId = db.prepare('SELECT id FROM game_modes WHERE slug=\'skipnot\'').get().id;

    db.prepare(
      'INSERT INTO leaderboard (name, answers, time_ms, created_at, mode_id) VALUES (?, ?, ?, ?, ?)',
    ).run('TriviaP', 8, 4000, Date.now(), triviaId);
    db.prepare(
      'INSERT INTO leaderboard (name, answers, time_ms, created_at, mode_id) VALUES (?, ?, ?, ?, ?)',
    ).run('SkipP', 200, 60000, Date.now(), skipId);

    const triviaTop = db
      .prepare('SELECT name, answers FROM leaderboard WHERE mode_id = ?')
      .all(triviaId);
    const skipTop = db
      .prepare('SELECT name, answers FROM leaderboard WHERE mode_id = ?')
      .all(skipId);

    expect(triviaTop).toHaveLength(1);
    expect(triviaTop[0].name).toBe('TriviaP');
    expect(skipTop).toHaveLength(1);
    expect(skipTop[0].name).toBe('SkipP');
    db.close();
  });

  it('FK constraint rejects scores for nonexistent mode_id when foreign_keys=ON', () => {
    const dbPath = createTestDb();
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    createSchema(db);

    expect(() =>
      db
        .prepare(
          'INSERT INTO leaderboard (name, answers, time_ms, created_at, mode_id) VALUES (?, ?, ?, ?, ?)',
        )
        .run('GhostMode', 5, 1000, Date.now(), 9999),
    ).toThrow();
    db.close();
  });

  it('checks qualification with correct logic per mode', () => {
    const dbPath = createTestDb();
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    createSchema(db);

    const triviaId = db.prepare('SELECT id FROM game_modes WHERE slug=\'triviandom\'').get().id;

    // 10 entries with answers 9..0
    for (let i = 0; i < 10; i++) {
      db.prepare(
        'INSERT INTO leaderboard (name, answers, time_ms, created_at, mode_id) VALUES (?, ?, ?, ?, ?)',
      ).run(`P${i}`, 9 - i, 1000 + i * 100, Date.now(), triviaId);
    }

    // answers > 8 → P0(9). answers = 8 AND time_ms < 1500 → P1(8 @ 1100). Total 2.
    const result = db
      .prepare(
        'SELECT COUNT(*) as cnt FROM leaderboard WHERE mode_id = ? AND (answers > ? OR (answers = ? AND time_ms < ?))',
      )
      .get(triviaId, 8, 8, 1500);
    expect(result.cnt).toBe(2);

    db.close();
  });
});
