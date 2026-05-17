import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../server/index.js';
import { getDb } from '../server/game/leaderboard.ts';

const ADMIN_SECRET = process.env.ADMIN_SECRET;

function agent() {
  return request.agent(app);
}

async function adminAgent() {
  const a = agent();
  await a.get('/admin/').set('x-admin-key', ADMIN_SECRET).expect(200);
  return a;
}

async function createTestUser(username, email, password = 'testpass123') {
  await request(app).post('/auth/register').send({ username, email, password });
}

beforeAll(async () => {
  // Wait for Redis to connect before running admin tests (gate returns 503 otherwise)
  for (let i = 0; i < 20; i++) {
    const res = await request(app).get('/');
    if (res.status !== 503) {
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
});

afterAll(() => {
  const db = getDb();
  if (!db) {
    return;
  }
  db.prepare(
    "DELETE FROM user_stats WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'adm_%')",
  ).run();
  db.prepare(
    "DELETE FROM game_history WHERE player1_id IN (SELECT id FROM users WHERE username LIKE 'adm_%') OR player2_id IN (SELECT id FROM users WHERE username LIKE 'adm_%')",
  ).run();
  db.prepare("DELETE FROM users WHERE username LIKE 'adm_%'").run();
});

// ========== AUTH / RATE LIMITING ==========

describe('Admin auth', () => {
  it('rejects unauthenticated requests with 403', async () => {
    const res = await request(app).get('/admin/');
    expect(res.status).toBe(403);
    expect(res.text).toContain('Access Denied');
  });

  it('rejects invalid admin key with 403', async () => {
    const res = await request(app).get('/admin/').set('x-admin-key', 'wrong');
    expect(res.status).toBe(403);
  });

  it('rejects admin key via query param', async () => {
    const a = agent();
    const res = await a.get(`/admin/?admin_key=${ADMIN_SECRET}`);
    expect(res.status).toBe(403);
  });

  it('grants access with valid admin key via header', async () => {
    const a = agent();
    const res = await a.get('/admin/').set('x-admin-key', ADMIN_SECRET);
    expect(res.status).toBe(200);
  });

  it('persists admin session after initial auth', async () => {
    const a = agent();
    await a.get('/admin/').set('x-admin-key', ADMIN_SECRET).expect(200);
    const res = await a.get('/admin/users');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Users');
  });

  it('rate-limits after repeated failures', async () => {
    const a = agent();
    for (let i = 0; i < 5; i++) {
      await a.get('/admin/').set('x-admin-key', 'wrong').set('x-forwarded-for', '10.99.99.99');
    }
    const res = await a
      .get('/admin/')
      .set('x-admin-key', 'wrong')
      .set('x-forwarded-for', '10.99.99.99');
    expect(res.status).toBe(429);
    expect(res.text).toContain('Too Many Requests');
  });
});

// ========== DASHBOARD ==========

describe('Admin dashboard', () => {
  it('renders dashboard with stats', async () => {
    const a = await adminAgent();
    const res = await a.get('/admin/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Total Users');
    expect(res.text).toContain('Qlashique Games');
    expect(res.text).toContain('Quiz Scores');
  });
});

// ========== USERS ==========

describe('Admin users', () => {
  const unique = Math.random().toString(36).slice(2, 8);
  const username = `adm_${unique}`;
  const email = `adm_${unique}@test.invalid`;
  let userId;

  beforeAll(async () => {
    await createTestUser(username, email);
    const db = getDb();
    const row = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    userId = row.id;
  });

  it('lists users', async () => {
    const a = await adminAgent();
    const res = await a.get('/admin/users');
    expect(res.status).toBe(200);
    expect(res.text).toContain(username);
  });

  it('shows user detail page', async () => {
    const a = await adminAgent();
    const res = await a.get(`/admin/users/${userId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(username);
    expect(res.text).toContain('Account Details');
    expect(res.text).toContain('Category Performance');
  });

  it('returns 404 for non-existent user', async () => {
    const a = await adminAgent();
    const res = await a.get('/admin/users/999999');
    expect(res.status).toBe(404);
    expect(res.text).toContain('User Not Found');
  });

  it('returns 400 for invalid user id', async () => {
    const a = await adminAgent();
    const res = await a.get('/admin/users/abc');
    expect(res.status).toBe(400);
  });

  it('updates user username and email', async () => {
    const newUsername = `adm_upd_${unique}`;
    const newEmail = `adm_upd_${unique}@test.invalid`;
    const a = await adminAgent();
    const res = await a
      .post('/admin/users/update')
      .type('form')
      .send({ id: userId, username: newUsername, email: newEmail });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/admin/users/${userId}`);

    const db = getDb();
    const row = db.prepare('SELECT username, email FROM users WHERE id = ?').get(userId);
    expect(row.username).toBe(newUsername);
    expect(row.email).toBe(newEmail);

    // restore
    db.prepare('UPDATE users SET username = ?, email = ? WHERE id = ?').run(
      username,
      email,
      userId,
    );
  });

  it('rejects duplicate username on update', async () => {
    const dupeUnique = Math.random().toString(36).slice(2, 8);
    const dupeUser = `adm_dup_${dupeUnique}`;
    const dupeEmail = `adm_dup_${dupeUnique}@test.invalid`;
    await createTestUser(dupeUser, dupeEmail);

    const a = await adminAgent();
    const res = await a
      .post('/admin/users/update')
      .type('form')
      .send({ id: userId, username: dupeUser, email });
    expect(res.status).toBe(400);
    expect(res.text).toContain('already has that username');
  });

  it('rejects empty username on update', async () => {
    const a = await adminAgent();
    const res = await a
      .post('/admin/users/update')
      .type('form')
      .send({ id: userId, username: '', email });
    expect(res.status).toBe(400);
  });

  it('toggles admin flag', async () => {
    const a = await adminAgent();
    const res = await a
      .post('/admin/users/toggle-admin')
      .type('form')
      .send({ id: userId, is_admin: 1 });
    expect(res.status).toBe(302);

    const db = getDb();
    const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId);
    expect(row.is_admin).toBe(1);

    // restore
    await a.post('/admin/users/toggle-admin').type('form').send({ id: userId, is_admin: 0 });
  });

  it('toggles block flag', async () => {
    const a = await adminAgent();
    const res = await a
      .post('/admin/users/toggle-block')
      .type('form')
      .send({ id: userId, is_blocked: 1 });
    expect(res.status).toBe(302);

    const db = getDb();
    const row = db.prepare('SELECT is_blocked FROM users WHERE id = ?').get(userId);
    expect(row.is_blocked).toBe(1);

    // restore
    await a.post('/admin/users/toggle-block').type('form').send({ id: userId, is_blocked: 0 });
  });

  it('resets user stats', async () => {
    const a = await adminAgent();
    const res = await a.post('/admin/users/reset-stats').type('form').send({ id: userId });
    expect(res.status).toBe(302);

    const db = getDb();
    const row = db.prepare('SELECT games_played, games_won FROM users WHERE id = ?').get(userId);
    expect(row.games_played).toBe(0);
    expect(row.games_won).toBe(0);
  });

  it('generates password reset link', async () => {
    const a = await adminAgent();
    const res = await a.post('/admin/users/reset-password').type('form').send({ id: userId });
    expect(res.status).toBe(302);

    const db = getDb();
    const row = db
      .prepare('SELECT reset_token, reset_token_expires FROM users WHERE id = ?')
      .get(userId);
    expect(row.reset_token).toBeTruthy();
    expect(row.reset_token_expires).toBeGreaterThan(Date.now());
  });

  it('resends confirmation email for unconfirmed user', async () => {
    const a = await adminAgent();
    const res = await a.post('/admin/users/resend-email').type('form').send({ id: userId });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/admin/users/${userId}`);
  });

  it('cascade-deletes user', async () => {
    const delUnique = Math.random().toString(36).slice(2, 8);
    const delUser = `adm_del_${delUnique}`;
    const delEmail = `adm_del_${delUnique}@test.invalid`;
    const db = getDb();
    db.prepare(
      'INSERT INTO users (username, email, password_hash, email_confirmed, is_blocked, is_admin, created_at) VALUES (?, ?, ?, 0, 0, 0, ?)',
    ).run(delUser, delEmail, 'hash', Date.now());
    const row = db.prepare('SELECT id FROM users WHERE username = ?').get(delUser);

    const a = await adminAgent();
    const res = await a.post('/admin/users/delete').type('form').send({ id: row.id });
    expect(res.status).toBe(302);

    const deleted = db.prepare('SELECT id FROM users WHERE id = ?').get(row.id);
    expect(deleted).toBeUndefined();
  });

  it('rejects invalid id on toggle-admin', async () => {
    const a = await adminAgent();
    const res = await a
      .post('/admin/users/toggle-admin')
      .type('form')
      .send({ id: 'abc', is_admin: 1 });
    expect(res.status).toBe(400);
  });
});

// ========== STATISTICS ==========

describe('Admin statistics', () => {
  it('renders stats page', async () => {
    const a = await adminAgent();
    const res = await a.get('/admin/stats');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Total Users');
    expect(res.text).toContain('Recent Games');
    expect(res.text).toContain('Category Performance');
  });
});

// ========== EXPORT ==========

describe('Admin export', () => {
  it('exports all data as JSON', async () => {
    const a = await adminAgent();
    const res = await a.get('/admin/export?type=all');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const data = JSON.parse(res.text);
    expect(data.exportedAt).toBeTruthy();
    expect(data.users).toBeInstanceOf(Array);
    expect(data.games).toBeInstanceOf(Array);
    expect(data.leaderboard).toBeInstanceOf(Array);
  });

  it('exports users only', async () => {
    const a = await adminAgent();
    const res = await a.get('/admin/export?type=users');
    expect(res.status).toBe(200);
    const data = JSON.parse(res.text);
    expect(data.users).toBeInstanceOf(Array);
    expect(data.games).toBeUndefined();
  });

  it('exports per-user stats', async () => {
    const db = getDb();
    const anyUser = db.prepare('SELECT id FROM users LIMIT 1').get();
    if (!anyUser) {
      return;
    }

    const a = await adminAgent();
    const res = await a.get(`/admin/users/${anyUser.id}/export`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const data = JSON.parse(res.text);
    expect(data.user).toBeTruthy();
    expect(data.statistics).toBeInstanceOf(Array);
  });

  it('returns 404 for per-user export of non-existent user', async () => {
    const a = await adminAgent();
    const res = await a.get('/admin/users/999999/export');
    expect(res.status).toBe(404);
  });
});
