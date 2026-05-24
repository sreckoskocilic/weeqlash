import { describe, it, expect, afterAll } from 'vitest';
import '../server/index.js';
import { getDb } from '../server/game/leaderboard.ts';
import { getUserStats } from '../server/game/auth.ts';

const TEST_PREFIX = `stats_${Date.now()}`;

function createUser(username, email, gamesPlayed = 0, gamesWon = 0) {
  const db = getDb();
  const result = db
    .prepare(
      `
      INSERT INTO users (username, email, password_hash, email_confirmed, created_at, games_played, games_won)
      VALUES (?, ?, ?, 1, ?, ?, ?)
    `,
    )
    .run(username, email, 'hash', Date.now(), gamesPlayed, gamesWon);
  return Number(result.lastInsertRowid);
}

describe('auth stats', () => {
  afterAll(() => {
    const db = getDb();
    if (!db) {
      return;
    }
    db.prepare(
      'DELETE FROM game_history WHERE player1_id IN (SELECT id FROM users WHERE username LIKE ?) OR player2_id IN (SELECT id FROM users WHERE username LIKE ?)',
    ).run(`${TEST_PREFIX}%`, `${TEST_PREFIX}%`);
    db.prepare(
      'DELETE FROM user_stats WHERE user_id IN (SELECT id FROM users WHERE username LIKE ?)',
    ).run(`${TEST_PREFIX}%`);
    db.prepare('DELETE FROM users WHERE username LIKE ?').run(`${TEST_PREFIX}%`);
  });

  it('counts Weeqlash/Qlashique user totals plus completed HowHigh history', () => {
    const db = getDb();
    expect(db).toBeTruthy();

    const p1Id = createUser(`${TEST_PREFIX}_p1`, `${TEST_PREFIX}_p1@test.invalid`, 1, 1);
    const p2Id = createUser(`${TEST_PREFIX}_p2`, `${TEST_PREFIX}_p2@test.invalid`, 1, 0);

    db.prepare(
      `
      INSERT INTO game_history
        (player1_id, player2_id, winner_id, game_mode, board_size, duration_ms, player1_stats, player2_stats, created_at)
      VALUES (?, ?, ?, 'qlashique', NULL, 1000, ?, ?, ?)
    `,
    ).run(p1Id, p2Id, p1Id, JSON.stringify({ finalHp: 1 }), JSON.stringify({ finalHp: 0 }), Date.now());

    db.prepare(
      `
      INSERT INTO game_history
        (player1_id, player2_id, winner_id, game_mode, board_size, duration_ms, player1_stats, player2_stats, created_at)
      VALUES (?, ?, ?, 'howhigh', NULL, 1000, ?, ?, ?)
    `,
    ).run(p1Id, p2Id, p1Id, JSON.stringify({ score: 20 }), JSON.stringify({ score: 10 }), Date.now());

    expect(getUserStats(p1Id)).toMatchObject({ gamesPlayed: 2, gamesWon: 2 });
    expect(getUserStats(p2Id)).toMatchObject({ gamesPlayed: 2, gamesWon: 0 });
  });
});
