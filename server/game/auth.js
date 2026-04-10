import { getDb } from './leaderboard.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

const SALT_ROUNDS = 10;

export function initAuthDb() {
  const db = getDb();
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

function applySchemaMigrations(db) {
  try {
    // Check if games_played column exists, add if not
    const tableInfo = db.prepare('PRAGMA table_info(users)').all();
    const columns = tableInfo.map(col => col.name);

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
  } catch (error) {
    console.warn('[auth] Schema migration warning:', error.message);
    // Don't fail initialization if migration has issues
  }
}

// --- User CRUD ---

export function createUser({ username, email, password }) {
  const db = getDb();
  const now = Date.now();

  const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existingUser) {
    return { error: 'Username already taken' };
  }

  const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existingEmail) {
    return { error: 'Email already registered' };
  }

  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
  const confirmToken = crypto.randomBytes(32).toString('hex');

  const stmt = db.prepare(`
    INSERT INTO users (username, email, password_hash, confirmation_token, created_at, games_played, games_won)
    VALUES (?, ?, ?, ?, ?, 0, 0)
  `);
  const result = stmt.run(username, email, passwordHash, confirmToken, now);

  return {
    ok: true,
    userId: result.lastInsertRowid,
    confirmToken,
  };
}

export function authenticateUser(usernameOrEmail, password) {
  const db = getDb();
  const user = db.prepare(
    'SELECT * FROM users WHERE username = ? OR email = ?'
  ).get(usernameOrEmail, usernameOrEmail);

  if (!user) {
    return { error: 'Invalid credentials' };
  }

  if (user.is_blocked) {
    return { error: 'Account is blocked' };
  }

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return { error: 'Invalid credentials' };
  }

  if (!user.email_confirmed) {
    return { error: 'Email not confirmed', needsConfirmation: true, userId: user.id };
  }

  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(Date.now(), user.id);

  return {
    ok: true,
    user: { id: user.id, username: user.username, email: user.email },
  };
}

export function getUserById(id) {
  const db = getDb();
  const user = db.prepare('SELECT id, username, email, email_confirmed, is_blocked, created_at, last_login FROM users WHERE id = ?').get(id);
  return user || null;
}

export function confirmEmail(token) {
  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE confirmation_token = ?').get(token);
  if (!user) {
    return { error: 'Invalid confirmation token' };
  }
  db.prepare('UPDATE users SET email_confirmed = 1, confirmation_token = NULL WHERE id = ?').run(user.id);
  return { ok: true };
}

export function createResetToken(email) {
  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!user) {
    // Don't reveal if email exists
    return { ok: true };
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + 3600000; // 1 hour

  db.prepare('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?')
    .run(resetToken, expires, user.id);

  return { ok: true, resetToken };
}

export function resetPassword(token, newPassword) {
  const db = getDb();
  const user = db.prepare(
    'SELECT id FROM users WHERE reset_token = ? AND reset_token_expires > ?'
  ).get(token, Date.now());

  if (!user) {
    return { error: 'Invalid or expired reset token' };
  }

  const passwordHash = bcrypt.hashSync(newPassword, SALT_ROUNDS);
  db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?')
    .run(passwordHash, user.id);

  return { ok: true };
}

export function resendConfirmation(userId) {
  const db = getDb();
  const user = db.prepare('SELECT id, email_confirmed FROM users WHERE id = ?').get(userId);
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

// --- User Management (Admin) ---

export function blockUser(userId) {
  const db = getDb();
  db.prepare('UPDATE users SET is_blocked = 1 WHERE id = ?').run(userId);
  return { ok: true };
}

export function unblockUser(userId) {
  const db = getDb();
  db.prepare('UPDATE users SET is_blocked = 0 WHERE id = ?').run(userId);
  return { ok: true };
}

export function adminResetPassword(userId, newPassword) {
  const db = getDb();
  const passwordHash = bcrypt.hashSync(newPassword, SALT_ROUNDS);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
  return { ok: true };
}

export function getAllUsers({ limit = 50, offset = 0 } = {}) {
  const db = getDb();
  const users = db.prepare(`
    SELECT id, username, email, email_confirmed, is_blocked, created_at, last_login
    FROM users
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
  const total = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  return { users, total };
}

// --- Stats ---

export function trackAnswer(userId, category, correct) {
  const db = getDb();
  db.prepare(`
    INSERT INTO user_stats (user_id, category, answered, correct)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(user_id, category) DO UPDATE SET
      answered = answered + 1,
      correct = correct + excluded.correct
  `).run(userId, category, correct ? 1 : 0);
}

export function getUserStats(userId) {
  const db = getDb();

  const categoryStats = db.prepare(
    'SELECT category, answered, correct FROM user_stats WHERE user_id = ? ORDER BY category'
  ).all(userId);

  const totals = categoryStats.reduce(
    (acc, s) => {
      acc.totalAnswered += s.answered;
      acc.totalCorrect += s.correct;
      return acc;
    },
    { totalAnswered: 0, totalCorrect: 0 }
  );

  const gameWinRatio = db.prepare(
      'SELECT games_played, games_won FROM users WHERE id = ?'
  ).get(userId);

  const gameStats = { games: gameWinRatio['games_played'], wins: gameWinRatio['games_won']};

  return {
    categories: categoryStats,
    ...totals,
    ...gameStats,
  };
}

export function getUserHistory(userId, limit = 20) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT
      gh.*,
      u1.username as player1_name,
      u2.username as player2_name,
      w.username as winner_name
    FROM game_history gh
    JOIN users u1 ON gh.player1_id = u1.id
    JOIN users u2 ON gh.player2_id = u2.id
    LEFT JOIN users w ON gh.winner_id = w.id
    WHERE gh.player1_id = ? OR gh.player2_id = ?
    ORDER BY gh.created_at DESC
    LIMIT ?
  `);
  return stmt.all(userId, userId, limit);
}

export function insertGameResult({ player1Id, player2Id, winnerId, gameMode, boardSize, durationMs, player1Stats, player2Stats }) {
  const db = getDb();
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
    Date.now()
  );
  return { ok: true, id: result.lastInsertRowid };
}