import { describe, it, expect, beforeAll } from 'vitest';
import './helpers/isolate-db.js';
import { initDb, getDb } from '../server/game/leaderboard.ts';
import { initAuthDb } from '../server/game/auth.ts';
import {
  createChallenge,
  finishP1,
  joinChallenge,
  finishP2,
} from '../server/game/howhigh-store.ts';

let p1Id;
let p2Id;

function makeUser(name) {
  const db = getDb();
  const r = db
    .prepare(
      `INSERT INTO users (username, email, password_hash, email_confirmed, created_at, games_played, games_won)
       VALUES (?, ?, 'hash', 1, ?, 0, 0)`,
    )
    .run(name, `${name}@test.invalid`, Date.now());
  return Number(r.lastInsertRowid);
}

function activeChallenge(p1Score, p1TimeMs, { p1Gowild = false } = {}) {
  const code = createChallenge(
    p1Id,
    ['q1', 'q2'],
    ['e1'],
    { die1: 3, die2: 4 },
    'double_or_nothing',
    'time_crunch',
  );
  finishP1(code, p1Score, ['correct'], false, p1Gowild, p1TimeMs);
  joinChallenge(code, p2Id);
  return code;
}

beforeAll(() => {
  initDb();
  initAuthDb();
  p1Id = makeUser('hh_p1');
  p2Id = makeUser('hh_p2');
});

describe('howhigh-store: finishP2 winner determination', () => {
  it('higher P2 score wins for P2', () => {
    const code = activeChallenge(20, 10000);
    const row = finishP2(code, 30, ['correct'], false, false, 10000);
    expect(row.winner_id).toBe(p2Id);
    expect(row.status).toBe('complete');
  });

  it('lower P2 score wins for P1', () => {
    const code = activeChallenge(30, 10000);
    const row = finishP2(code, 20, ['correct'], false, false, 10000);
    expect(row.winner_id).toBe(p1Id);
  });

  it('tie broken by lower average time — P2 faster wins for P2', () => {
    const code = activeChallenge(20, 10000);
    const row = finishP2(code, 20, ['correct'], false, false, 8000);
    expect(row.winner_id).toBe(p2Id);
  });

  it('tie broken by lower average time — P1 faster wins for P1', () => {
    const code = activeChallenge(20, 8000);
    const row = finishP2(code, 20, ['correct'], false, false, 10000);
    expect(row.winner_id).toBe(p1Id);
  });

  it('tie uses the gowild divisor (12) vs base (10) for the average', () => {
    // P1 gowild: 11000/12 = 916.7. P2 base: 9500/10 = 950. P1 lower → P1 wins.
    const code = activeChallenge(20, 11000, { p1Gowild: true });
    const row = finishP2(code, 20, ['correct'], false, false, 9500);
    expect(row.winner_id).toBe(p1Id);
  });
});

describe('howhigh-store: status guards', () => {
  it('finishP1 twice throws (row no longer pending)', () => {
    const code = createChallenge(
      p1Id,
      ['q1'],
      [],
      { die1: 1, die2: 2 },
      'double_or_nothing',
      'time_crunch',
    );
    finishP1(code, 10, ['correct'], false, false, 5000);
    expect(() => finishP1(code, 10, ['correct'], false, false, 5000)).toThrow();
  });

  it('joining your own challenge throws', () => {
    const code = createChallenge(
      p1Id,
      ['q1'],
      [],
      { die1: 1, die2: 2 },
      'double_or_nothing',
      'time_crunch',
    );
    finishP1(code, 10, ['correct'], false, false, 5000);
    expect(() => joinChallenge(code, p1Id)).toThrow();
  });

  it('finishP2 on a non-active challenge throws', () => {
    const code = createChallenge(
      p1Id,
      ['q1'],
      [],
      { die1: 1, die2: 2 },
      'double_or_nothing',
      'time_crunch',
    );
    finishP1(code, 10, ['correct'], false, false, 5000); // status 'waiting', never joined
    expect(() => finishP2(code, 20, ['correct'], false, false, 5000)).toThrow();
  });
});
