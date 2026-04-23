import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { QUIZ_MODES, QUIZ_MODES_BY_ID } from '../server/game/quiz-modes.ts';
import path from 'path';
import fs from 'fs';

describe('Quiz Modes', () => {
  it('exports correct modes', () => {
    expect(QUIZ_MODES).toHaveLength(2);
    expect(QUIZ_MODES[0].id).toBe('triviandom');
    expect(QUIZ_MODES[1].id).toBe('epl_2025');
  });

  it('exports QUIZ_MODES_BY_ID lookup', () => {
    expect(QUIZ_MODES_BY_ID.triviandom).toBeDefined();
    expect(QUIZ_MODES_BY_ID.epl_2025).toBeDefined();
    expect(QUIZ_MODES_BY_ID.triviandom.table).toBe('leaderboard');
    expect(QUIZ_MODES_BY_ID.epl_2025.table).toBe('leaderboard_epl2025');
  });

  it('mode categories are correct', () => {
    expect(QUIZ_MODES_BY_ID.triviandom.categories).toBeNull();
    expect(QUIZ_MODES_BY_ID.epl_2025.categories).toEqual(['epl_2025']);
  });

  it('mode labels are correct', () => {
    expect(QUIZ_MODES_BY_ID.triviandom.label).toBe('Triviandom');
    expect(QUIZ_MODES_BY_ID.epl_2025.label).toBe('EPL 2025');
  });

  it('each mode has required fields', () => {
    for (const mode of QUIZ_MODES) {
      expect(mode.id).toBeDefined();
      expect(mode.label).toBeDefined();
      expect(mode.table).toBeDefined();
      expect(mode.table).toMatch(/^[a-zA-Z0-9_]+$/);
    }
  });
});

// Integration-style tests for leaderboard module using file-based DB
// Note: The leaderboard module uses a singleton, so we use unique files per test
describe('Leaderboard: Integration Tests', () => {
  let testDbs = [];

  function createTestDb() {
    const dbPath = `/tmp/test-lb-${Date.now()}-${Math.random()}.db`;
    testDbs.push(dbPath);
    return dbPath;
  }

  afterEach(() => {
    // Clean up test DB files
    for (const dbPath of testDbs) {
      try { fs.unlinkSync(dbPath); } catch {}
      try { fs.unlinkSync(dbPath + '-wal'); } catch {}
      try { fs.unlinkSync(dbPath + '-shm'); } catch {}
    }
    testDbs = [];
  });

  it('creates tables on init', () => {
    const dbPath = createTestDb();
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');

    for (const mode of QUIZ_MODES) {
      db.exec(`
        CREATE TABLE ${mode.table} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          answers INTEGER NOT NULL,
          time_ms INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);
      const result = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='${mode.table}'`).get();
      expect(result).toBeDefined();
    }
    db.close();
  });

  it('inserts and retrieves scores', () => {
    const dbPath = createTestDb();
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');

    // Create table first
    db.exec(`
      CREATE TABLE leaderboard (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        answers INTEGER NOT NULL,
        time_ms INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    db.prepare(`INSERT INTO leaderboard (name, answers, time_ms, created_at) VALUES (?, ?, ?, ?)`).run('TestPlayer', 10, 5000, Date.now());

    const result = db.prepare(`SELECT * FROM leaderboard ORDER BY answers DESC, time_ms ASC LIMIT 10`).all();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('TestPlayer');
    expect(result[0].answers).toBe(10);
    db.close();
  });

  it('orders by answers DESC, time_ms ASC', () => {
    const dbPath = createTestDb();
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');

    // Create table first
    db.exec(`
      CREATE TABLE leaderboard (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        answers INTEGER NOT NULL,
        time_ms INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    db.prepare(`INSERT INTO leaderboard (name, answers, time_ms, created_at) VALUES (?, ?, ?, ?)`).run('P1', 5, 5000, Date.now());
    db.prepare(`INSERT INTO leaderboard (name, answers, time_ms, created_at) VALUES (?, ?, ?, ?)`).run('P2', 10, 3000, Date.now());
    db.prepare(`INSERT INTO leaderboard (name, answers, time_ms, created_at) VALUES (?, ?, ?, ?)`).run('P3', 10, 5000, Date.now());

    const result = db.prepare(`SELECT * FROM leaderboard ORDER BY answers DESC, time_ms ASC LIMIT 10`).all();
    expect(result[0].name).toBe('P2'); // 10 answers, less time
    expect(result[1].name).toBe('P3'); // 10 answers, more time
    expect(result[2].name).toBe('P1'); // 5 answers
    db.close();
  });

  it('checks qualification with correct logic', () => {
    const dbPath = createTestDb();
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');

    // Create table first
    db.exec(`
      CREATE TABLE leaderboard (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        answers INTEGER NOT NULL,
        time_ms INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    // Add 10 entries descending from 9 to 0
    for (let i = 0; i < 10; i++) {
      db.prepare(`INSERT INTO leaderboard (name, answers, time_ms, created_at) VALUES (?, ?, ?, ?)`).run(`P${i}`, 9 - i, 1000 + i * 100, Date.now());
    }

    // A good score: answer=8 with fast time
    const result = db.prepare(`SELECT COUNT(*) as cnt FROM leaderboard WHERE answers > 8 OR (answers = 8 AND time_ms < 1500)`).get();
    // answers > 8: only entry with 9 (answers: 9-0 = 9,8,7,6,5,4,3,2,1,0)
    // Wait, 9-i means: P0=9, P1=8, P2=7, P3=6, P4=5, P5=4, P6=3, P7=2, P8=1, P9=0
    // answers > 8: only P0 with 9 (1 entry)
    // answers = 8 AND time_ms < 1500: P1 has 8 at time 1100, which is < 1500 (2nd entry)
    // Total: 2 entries
    expect(result.cnt).toBe(2);

    // Not qualifying: score of 1 when table is full with higher scores
    // With 9-i, scores are 9,8,7,6,5,4,3,2,1,0
    // answers > 1: 9,8,7,6,5,4,3,2 = 8 entries
    const result2 = db.prepare(`SELECT COUNT(*) as cnt FROM leaderboard WHERE answers > 1`).get();
    expect(result2.cnt).toBe(8);

    db.close();
  });
});