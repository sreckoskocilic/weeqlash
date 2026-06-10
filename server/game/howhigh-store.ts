import { getDb } from './leaderboard.ts';
import { BASE_Q_COUNT, GOWILD_Q_COUNT } from './howhigh.ts';
import type Database from 'better-sqlite3';

export interface ChallengeRow {
  id: number;
  code: string;
  player1_id: number;
  player2_id: number | null;
  question_ids: string;
  extra_question_ids: string | null;
  dice_die1: number;
  dice_die2: number;
  p1_score: number | null;
  p1_results: string | null;
  p1_dice_accepted: number | null;
  p1_gowild_accepted: number | null;
  p1_time_ms: number | null;
  p1_finished_at: number | null;
  p2_score: number | null;
  p2_results: string | null;
  p2_dice_accepted: number | null;
  p2_gowild_accepted: number | null;
  p2_time_ms: number | null;
  p2_finished_at: number | null;
  winner_id: number | null;
  status: string;
  created_at: number;
  bonus_q3: string | null;
  bonus_q6: string | null;
  completed_at: number | null;
}

function requireDb(): Database.Database {
  const db = getDb();
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(): string {
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

export function createChallenge(
  p1Id: number,
  questionIds: string[],
  extraQuestionIds: string[],
  dice: { die1: number; die2: number },
  bonusQ3: string,
  bonusQ6: string,
): string {
  const db = requireDb();
  const stmt = db.prepare(`
    INSERT INTO howhigh_challenges
      (code, player1_id, question_ids, extra_question_ids, dice_die1, dice_die2, bonus_q3, bonus_q6, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `);
  let code: string;
  let attempts = 0;
  while (true) {
    code = generateCode();
    try {
      stmt.run(
        code,
        p1Id,
        JSON.stringify(questionIds),
        JSON.stringify(extraQuestionIds),
        dice.die1,
        dice.die2,
        bonusQ3,
        bonusQ6,
        Date.now(),
      );
      break;
    } catch (err: any) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' && ++attempts < 10) {
        continue;
      }
      throw err;
    }
  }
  return code;
}

export function finishP1(
  code: string,
  score: number,
  results: string[],
  diceAccepted: boolean,
  goWildAccepted: boolean,
  timeMs: number,
): void {
  const db = requireDb();
  const res = db
    .prepare(
      `UPDATE howhigh_challenges
       SET p1_score = ?, p1_results = ?, p1_dice_accepted = ?, p1_gowild_accepted = ?,
           p1_time_ms = ?, p1_finished_at = ?, status = 'waiting'
       WHERE code = ? AND status = 'pending'`,
    )
    .run(
      score,
      JSON.stringify(results),
      diceAccepted ? 1 : 0,
      goWildAccepted ? 1 : 0,
      timeMs,
      Date.now(),
      code,
    );
  if (res.changes === 0) {
    throw new Error('Challenge not found or not pending');
  }
}

export function joinChallenge(code: string, p2Id: number): ChallengeRow {
  const db = requireDb();
  const res = db
    .prepare(
      `UPDATE howhigh_challenges
       SET player2_id = ?, status = 'active'
       WHERE code = ? AND status = 'waiting' AND player2_id IS NULL AND player1_id != ?`,
    )
    .run(p2Id, code, p2Id);
  if (res.changes === 0) {
    throw new Error('Challenge not found, not waiting, or same player');
  }
  return db.prepare('SELECT * FROM howhigh_challenges WHERE code = ?').get(code) as ChallengeRow;
}

export function finishP2(
  code: string,
  score: number,
  results: string[],
  diceAccepted: boolean,
  goWildAccepted: boolean,
  timeMs: number,
): ChallengeRow {
  const db = requireDb();
  const challenge = db.prepare('SELECT * FROM howhigh_challenges WHERE code = ?').get(code) as
    | ChallengeRow
    | undefined;
  if (!challenge || challenge.status !== 'active') {
    throw new Error('Challenge not found or not active');
  }

  let winnerId: number | null;
  if (score > challenge.p1_score!) {
    winnerId = challenge.player2_id;
  } else if (score < challenge.p1_score!) {
    winnerId = challenge.player1_id;
  } else {
    const p1Avg =
      challenge.p1_time_ms! / (challenge.p1_gowild_accepted ? GOWILD_Q_COUNT : BASE_Q_COUNT);
    const p2Avg = timeMs / (goWildAccepted ? GOWILD_Q_COUNT : BASE_Q_COUNT);
    winnerId = p2Avg < p1Avg ? challenge.player2_id : challenge.player1_id;
  }

  // Guard status in the UPDATE (not just the SELECT): changes===0 means the row left 'active' between read and write — correct under concurrency.
  const info = db
    .prepare(
      `UPDATE howhigh_challenges
       SET p2_score = ?, p2_results = ?, p2_dice_accepted = ?, p2_gowild_accepted = ?,
           p2_time_ms = ?, p2_finished_at = ?, winner_id = ?, status = 'complete', completed_at = ?
       WHERE code = ? AND status = 'active'`,
    )
    .run(
      score,
      JSON.stringify(results),
      diceAccepted ? 1 : 0,
      goWildAccepted ? 1 : 0,
      timeMs,
      Date.now(),
      winnerId,
      Date.now(),
      code,
    );
  if (info.changes === 0) {
    throw new Error('Challenge not found or not active');
  }

  return db.prepare('SELECT * FROM howhigh_challenges WHERE code = ?').get(code) as ChallengeRow;
}

export function getChallengeByCode(code: string): ChallengeRow | undefined {
  const db = requireDb();
  return db.prepare('SELECT * FROM howhigh_challenges WHERE code = ?').get(code) as
    | ChallengeRow
    | undefined;
}

export function getChallengesForUser(userId: number): ChallengeRow[] {
  const db = requireDb();
  return db
    .prepare(
      `SELECT * FROM howhigh_challenges
       WHERE (player1_id = ? OR player2_id = ?) AND status != 'expired'
       ORDER BY created_at DESC LIMIT 50`,
    )
    .all(userId, userId) as ChallengeRow[];
}

export function getUsernameById(userId: number): string | null {
  const db = requireDb();
  const row = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as
    | { username: string }
    | undefined;
  return row?.username ?? null;
}

// Batch getUsernameById: one IN (...) query to avoid an N+1 over up to 50 challenges.
export function getUsernamesByIds(ids: (number | null | undefined)[]): Map<number, string> {
  const out = new Map<number, string>();
  const unique = [...new Set(ids.filter((id): id is number => id !== null && id !== undefined))];
  if (unique.length === 0) {
    return out;
  }
  const db = requireDb();
  const placeholders = unique.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT id, username FROM users WHERE id IN (${placeholders})`)
    .all(...unique) as { id: number; username: string }[];
  for (const row of rows) {
    out.set(row.id, row.username);
  }
  return out;
}

export function expireStale(maxAgeMs: number): number {
  const db = requireDb();
  const cutoff = Date.now() - maxAgeMs;
  const res = db
    .prepare(
      `UPDATE howhigh_challenges SET status = 'expired'
       WHERE status IN ('pending', 'waiting') AND created_at < ?`,
    )
    .run(cutoff);
  return res.changes;
}
