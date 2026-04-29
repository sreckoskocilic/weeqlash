import { getDb } from './leaderboard.ts';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import Database from 'better-sqlite3';

const SALT_ROUNDS = 10;

export function initAuthDb() {
  const db: Database.Database | null = getDb();
  if (!db) {
    return { error: 'Database not initialized — call initDb() first' };
  }

  db.exec(`
     CREATE TABLE IF NOT EXISTS users (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       username TEXT UNIQUE NOT NULL,
       email TEXT UNIQUE NOT NULL,
       password_hash TEXT NOT NULL,
       email_confirmed INTEGER NOT NULL DEFAULT 0,
       confirmation_token TEXT,
       reset_token TEXT,
       reset_token_expires INTEGER,
       is_blocked INTEGER NOT NULL DEFAULT 0,
       is_admin INTEGER NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL,
       last_login INTEGER,
       games_played INTEGER NOT NULL DEFAULT 0,
       games_won INTEGER NOT NULL DEFAULT 0
     );

    CREATE TABLE IF NOT EXISTS user_stats (
      user_id INTEGER NOT NULL REFERENCES users(id),
      category TEXT NOT NULL,
      answered INTEGER NOT NULL DEFAULT 0,
      correct INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, category)
    );

    CREATE TABLE IF NOT EXISTS game_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player1_id INTEGER NOT NULL REFERENCES users(id),
      player2_id INTEGER REFERENCES users(id),
      winner_id INTEGER REFERENCES users(id),
      game_mode TEXT NOT NULL,
      board_size INTEGER,
      duration_ms INTEGER,
      player1_stats TEXT,
      player2_stats TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_confirmation_token ON users(confirmation_token);
    CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_token);
    CREATE INDEX IF NOT EXISTS idx_user_stats_user ON user_stats(user_id);
    CREATE INDEX IF NOT EXISTS idx_game_history_player1 ON game_history(player1_id);
    CREATE INDEX IF NOT EXISTS idx_game_history_player2 ON game_history(player2_id);
    CREATE INDEX IF NOT EXISTS idx_game_history_created ON game_history(created_at DESC);
  `);

  // Apply schema migrations to ensure existing tables are up to date
  applySchemaMigrations(db);

  console.log('[auth] DB tables initialized');
  return { ok: true };
}

function applySchemaMigrations(db: Database.Database) {
  try {
    // Check if games_played column exists, add if not
    const tableInfo = db.prepare('PRAGMA table_info(users)').all();
    const columns = tableInfo.map((col) => {
      return (col as { name: string }).name;
    });

    // Add games_played column if missing
    if (!columns.includes('games_played')) {
      db.prepare('ALTER TABLE users ADD COLUMN games_played INTEGER NOT NULL DEFAULT 0').run();
      console.log('[auth] Added games_played column to users table');
    }

    // Add games_won column if missing
    if (!columns.includes('games_won')) {
      db.prepare('ALTER TABLE users ADD COLUMN games_won INTEGER NOT NULL DEFAULT 0').run();
      console.log('[auth] Added games_won column to users table');
    }

    // Add is_admin column if missing
    if (!columns.includes('is_admin')) {
      db.prepare('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0').run();
      console.log('[auth] Added is_admin column to users table');
    }

    // Migrate renamed categories in user_stats (runs once; no-ops after old rows are gone)
    const oldCats = ['visual_arts', 'film_tv', 'books'];
    const hasOldRows = db
      .prepare(
        `SELECT 1 FROM user_stats WHERE category IN (${oldCats.map(() => '?').join(',')}) LIMIT 1`,
      )
      .get(...oldCats);
    if (hasOldRows) {
      const catRenames = [
        ['visual_arts', 'arts'],
        ['film_tv', 'entertainment'],
        ['books', 'literature'],
      ];
      const insertStmt = db.prepare(`
        INSERT INTO user_stats (user_id, category, answered, correct)
        SELECT user_id, ?, answered, correct FROM user_stats WHERE category = ?
        ON CONFLICT(user_id, category) DO UPDATE SET
          answered = user_stats.answered + excluded.answered,
          correct  = user_stats.correct  + excluded.correct
      `);
      const deleteStmt = db.prepare('DELETE FROM user_stats WHERE category = ?');
      db.transaction(() => {
        for (const [oldCat, newCat] of catRenames) {
          insertStmt.run(newCat, oldCat);
          deleteStmt.run(oldCat);
          console.log(`[auth] Migrated user_stats category: ${oldCat} -> ${newCat}`);
        }
      })();
    }
  } catch (error) {
    console.warn('[auth] Schema migration warning:', (error as Error).message);
    // Don't fail initialization if migration has issues
  }
}

// --- User CRUD ---

export async function createUser({
  username,
  email,
  password,
  autoConfirm = false,
}: {
  username: string;
  email: string;
  password: string;
  autoConfirm?: boolean;
}) {
  const db: Database.Database | null = getDb();
  if (!db) {
    throw new Error('Database not initialized');
  }

  // Validate password strength
  if (!password || password.length < 8) {
    return { error: 'Password must be at least 8 characters' };
  }

  const now = Date.now();

  const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as
    | { id: number }
    | undefined;
  if (existingUser) {
    return { error: 'Registration failed' };
  }

  const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as
    | { id: number }
    | undefined;
  if (existingEmail) {
    return { error: 'Registration failed' };
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const confirmToken = crypto.randomBytes(32).toString('hex');

  const stmt = db.prepare(`
    INSERT INTO users (username, email, password_hash, confirmation_token, created_at, email_confirmed, games_played, games_won)
    VALUES (?, ?, ?, ?, ?, ?, 0, 0)
  `);
  const result = stmt.run(username, email, passwordHash, confirmToken, now, autoConfirm ? 1 : 0);

  return {
    ok: true,
    userId: result.lastInsertRowid,
    confirmToken,
  };
}

export async function authenticateUser(
  usernameOrEmail: string,
  password: string,
): Promise<
  | { error: string; needsConfirmation?: boolean; userId?: number }
  | { ok: true; user: { id: number; username: string; email: string; is_admin: number } }
> {
  const db: Database.Database | null = getDb();
  if (!db) {
    throw new Error('Database not initialized');
  }
  const user = db
    .prepare(
      'SELECT id, username, email, password_hash, email_confirmed, is_blocked, is_admin FROM users WHERE username = ? OR email = ?',
    )
    .get(usernameOrEmail, usernameOrEmail) as
    | {
        id: number;
        username: string;
        email: string;
        password_hash: string;
        email_confirmed: number;
        is_blocked: number;
        is_admin: number;
        created_at: number;
        last_login: number | null;
      }
    | undefined;

  if (!user) {
    return { error: 'Invalid credentials' };
  }

  if (user.is_blocked) {
    return { error: 'Account is blocked' };
  }

  if (!(await bcrypt.compare(password, user.password_hash))) {
    return { error: 'Invalid credentials' };
  }

  // Bypass confirmation for test emails
  const needsConfirm = !user.email_confirmed && !user.email.endsWith('@test.invalid');
  if (needsConfirm) {
    return {
      error: 'Email not confirmed',
      needsConfirmation: true,
      userId: user.id,
    };
  }

  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(Date.now(), user.id);

  return {
    ok: true,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      is_admin: user.is_admin,
    },
  };
}

export function getUserById(id: number): {
  id: number;
  username: string;
  email: string;
  email_confirmed: number;
  is_blocked: number;
  is_admin: number;
  created_at: number;
  last_login: number | null;
} | null {
  const db: Database.Database | null = getDb();
  if (!db) {
    throw new Error('Database not initialized');
  }
  const user = db
    .prepare(
      'SELECT id, username, email, email_confirmed, is_blocked, is_admin, created_at, last_login FROM users WHERE id = ?',
    )
    .get(id) as
    | {
        id: number;
        username: string;
        email: string;
        email_confirmed: number;
        is_blocked: number;
        is_admin: number;
        created_at: number;
        last_login: number | null;
      }
    | undefined;
  return user || null;
}

export function confirmEmail(token: string) {
  const db: Database.Database | null = getDb();
  if (!db) {
    throw new Error('Database not initialized');
  }
  const user = db.prepare('SELECT id FROM users WHERE confirmation_token = ?').get(token) as
    | { id: number }
    | undefined;
  if (!user) {
    return { error: 'Invalid confirmation token' };
  }
  db.prepare('UPDATE users SET email_confirmed = 1, confirmation_token = NULL WHERE id = ?').run(
    user.id,
  );
  return { ok: true };
}

export function createResetToken(email: string) {
  const db: Database.Database | null = getDb();
  if (!db) {
    throw new Error('Database not initialized');
  }
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as
    | { id: number }
    | undefined;
  if (!user) {
    // Don't reveal if email exists
    return { ok: true };
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + 3600000; // 1 hour

  db.prepare('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?').run(
    resetToken,
    expires,
    user.id,
  );

  return { ok: true, resetToken };
}

export async function resetPassword(token: string, newPassword: string) {
  const db: Database.Database | null = getDb();
  if (!db) {
    throw new Error('Database not initialized');
  }
  const user = db
    .prepare('SELECT id FROM users WHERE reset_token = ? AND reset_token_expires > ?')
    .get(token, Date.now()) as { id: number } | undefined;

  if (!user) {
    return { error: 'Invalid or expired reset token' };
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  db.prepare(
    'UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?',
  ).run(passwordHash, user.id);

  return { ok: true };
}

export function resendConfirmation(userId: number) {
  const db: Database.Database | null = getDb();
  if (!db) {
    throw new Error('Database not initialized');
  }
  const user = db.prepare('SELECT id, email_confirmed FROM users WHERE id = ?').get(userId) as
    | {
        id: number;
        email_confirmed: number;
      }
    | undefined;
  if (!user) {
    return { error: 'User not found' };
  }
  if (user.email_confirmed) {
    return { error: 'Email already confirmed' };
  }

  const confirmToken = crypto.randomBytes(32).toString('hex');
  db.prepare('UPDATE users SET confirmation_token = ? WHERE id = ?').run(confirmToken, userId);
  return { ok: true, confirmToken };
}

// --- Stats ---

export function trackAnswer(userId: number, category: string, correct: boolean) {
  trackAnswersBatch(userId, category, 1, correct ? 1 : 0);
}

export function trackAnswersBatch(
  userId: number,
  category: string,
  answered: number,
  correct: number,
) {
  if (answered <= 0) {
    return;
  }
  const db: Database.Database | null = getDb();
  if (!db) {
    throw new Error('Database not initialized');
  }
  db.prepare(
    `
    INSERT INTO user_stats (user_id, category, answered, correct)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, category) DO UPDATE SET
      answered = answered + excluded.answered,
      correct = correct + excluded.correct
  `,
  ).run(userId, category, answered, correct);
}

export function getUserStats(userId: number) {
  const db: Database.Database | null = getDb();
  if (!db) {
    throw new Error('Database not initialized');
  }

  const categoryStats = db
    .prepare(
      'SELECT category, answered, correct FROM user_stats WHERE user_id = ? ORDER BY category',
    )
    .all(userId) as { category: string; answered: number; correct: number }[];

  const totals = categoryStats.reduce(
    (acc, s) => {
      acc.totalAnswered += s.answered;
      acc.totalCorrect += s.correct;
      return acc;
    },
    { totalAnswered: 0, totalCorrect: 0 },
  );

  const weeqlash = db
    .prepare('SELECT games_played, games_won FROM users WHERE id = ?')
    .get(userId) as { games_played: number; games_won: number } | null;

  const qlasRow = db
    .prepare(
      `
      SELECT
        COUNT(*) as played,
        SUM(CASE WHEN winner_id = ? THEN 1 ELSE 0 END) as won
      FROM game_history
      WHERE (player1_id = ? OR player2_id = ?)
        AND game_mode = 'qlashique'
        AND json_extract(player1_stats, '$.finalHp') IS NOT NULL
    `,
    )
    .get(userId, userId, userId) as { played: number; won: number } | null;

  const gameStats = {
    gamesPlayed: (weeqlash?.games_played || 0) + (qlasRow?.played || 0),
    gamesWon: (weeqlash?.games_won || 0) + (qlasRow?.won || 0),
  };

  return {
    categories: categoryStats,
    ...totals,
    ...gameStats,
  };
}

export function insertGameResult({
  player1Id,
  player2Id,
  winnerId,
  gameMode,
  boardSize,
  durationMs,
  player1Stats,
  player2Stats,
}: {
  player1Id: number;
  player2Id: number;
  winnerId: number;
  gameMode: string;
  boardSize: number;
  durationMs: number;
  player1Stats: any;
  player2Stats: any;
}) {
  const db: Database.Database | null = getDb();
  if (!db) {
    throw new Error('Database not initialized');
  }
  const stmt = db.prepare(`
    INSERT INTO game_history (player1_id, player2_id, winner_id, game_mode, board_size, duration_ms, player1_stats, player2_stats, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    player1Id,
    player2Id,
    winnerId,
    gameMode,
    boardSize || null,
    durationMs || null,
    JSON.stringify(player1Stats),
    JSON.stringify(player2Stats),
    Date.now(),
  );
  return { ok: true, id: result.lastInsertRowid };
}

export function clearTestUsers() {
  const db: Database.Database | null = getDb();
  if (!db) {
    throw new Error('Database not initialized');
  }
  try {
    // Delete child tables BEFORE parent (foreign key constraint)
    db.prepare(
      "DELETE FROM user_stats WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@test.invalid')",
    ).run();
    db.prepare(
      "DELETE FROM game_history WHERE player1_id IN (SELECT id FROM users WHERE email LIKE '%@test.invalid') OR player2_id IN (SELECT id FROM users WHERE email LIKE '%@test.invalid')",
    ).run();
    db.prepare("DELETE FROM users WHERE email LIKE '%@test.invalid'").run();
  } catch (err) {
    console.error('[auth] clearTestUsers() failed:', (err as Error).message);
  }
}

export function clearTestHistory() {
  const db: Database.Database | null = getDb();
  if (!db) {
    throw new Error('Database not initialized');
  }
  try {
    // Delete child tables BEFORE parent (foreign key constraint)
    db.prepare(
      "DELETE FROM user_stats WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@test.invalid')",
    ).run();
    db.prepare(
      `
      DELETE FROM game_history
      WHERE player1_id IN (SELECT id FROM users WHERE email LIKE '%@test.invalid')
         OR player2_id IN (SELECT id FROM users WHERE email LIKE '%@test.invalid')
    `,
    ).run();
  } catch (err) {
    console.error('[auth] clearTestHistory() failed:', (err as Error).message);
  }
}
