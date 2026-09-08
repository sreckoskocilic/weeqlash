import { describe, it, expect, vi, afterAll } from 'vitest';
import './helpers/isolate-db.js';
import request from 'supertest';
import { app } from '../server/index.js';
import * as emailModule from '../server/game/email.ts';
import { getDb } from '../server/game/leaderboard.ts';

// Security suite: session, DB (parameterized queries/table validation), and client (CSP/XSS) fixes

describe('Duel Stats Recording', () => {
  // Duel stats are recorded via recordGameStats (similar to qlashique)

  it('✓ game_history endpoint works (404 for non-existent user)', async () => {
    const res = await request(app).get('/test/game-history/nonexistent@test.invalid');
    // Returns 404 if user doesn't exist
    expect(res.status).toBe(404);
  });

  it('✓ user-stats endpoint works (404 for non-existent user)', async () => {
    const res = await request(app).get('/test/user-stats/nonexistent@test.invalid');
    // Returns 404 if user doesn't exist
    expect(res.status).toBe(404);
  });
});

describe('Security: session cookies', () => {
  it('sets an HttpOnly session cookie on first request', () => {
    return request(app)
      .get('/')
      .expect(200)
      .then((response) => {
        const setCookie = response.headers['set-cookie'];
        expect(setCookie).toBeDefined();
        expect(setCookie.some((c) => c.includes('HttpOnly'))).toBe(true);
      });
  });
});

describe('Resend confirmation email error handling', () => {
  const unique = Math.random().toString(36).slice(2, 8);
  const email = `resend_${unique}@test.invalid`;
  let cookies;

  afterAll(() => {
    const db = getDb();
    if (!db) {
      return;
    }
    db.prepare(
      "DELETE FROM user_stats WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'resend_%')",
    ).run();
    db.prepare("DELETE FROM users WHERE username LIKE 'resend_%'").run();
  });

  it('registers and logs in a test user', async () => {
    const spy = vi.spyOn(emailModule, 'sendEmail').mockResolvedValue(undefined);
    await request(app)
      .post('/auth/register')
      .send({ username: `resend_${unique}`, email, password: 'testpass123' });

    const login = await request(app)
      .post('/auth/login')
      .send({ username: `resend_${unique}`, password: 'testpass123' });
    expect(login.status).toBe(200);
    cookies = login.headers['set-cookie'];
    spy.mockRestore();
  });

  it('returns 500 when sendEmail throws', async () => {
    const spy = vi.spyOn(emailModule, 'sendEmail').mockRejectedValueOnce(new Error('SMTP down'));
    const res = await request(app).post('/auth/resend-confirmation').set('Cookie', cookies);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to send email');
    spy.mockRestore();
  });

  it('returns 200 when sendEmail succeeds', async () => {
    const spy = vi.spyOn(emailModule, 'sendEmail').mockResolvedValueOnce(undefined);
    const res = await request(app).post('/auth/resend-confirmation').set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    spy.mockRestore();
  });
});

describe('Security: single session per user', () => {
  const unique = Math.random().toString(36).slice(2, 8);
  const username = `sess_${unique}`;
  const email = `sess_${unique}@test.invalid`;

  afterAll(() => {
    const db = getDb();
    if (!db) {
      return;
    }
    db.prepare(
      "DELETE FROM user_stats WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'sess_%')",
    ).run();
    db.prepare("DELETE FROM users WHERE username LIKE 'sess_%'").run();
  });

  it('a second login invalidates the first session, and logout clears the last one', async () => {
    const spy = vi.spyOn(emailModule, 'sendEmail').mockResolvedValue(undefined);
    await request(app).post('/auth/register').send({ username, email, password: 'testpass123' });
    spy.mockRestore();

    const first = await request(app)
      .post('/auth/login')
      .send({ username, password: 'testpass123' });
    expect(first.status).toBe(200);
    const firstCookies = first.headers['set-cookie'];

    const meFirst = await request(app).get('/auth/me').set('Cookie', firstCookies);
    expect(meFirst.body.user?.username).toBe(username);

    const second = await request(app)
      .post('/auth/login')
      .send({ username, password: 'testpass123' });
    expect(second.status).toBe(200);
    const secondCookies = second.headers['set-cookie'];

    const meAfterKick = await request(app).get('/auth/me').set('Cookie', firstCookies);
    expect(meAfterKick.body.user).toBeNull();

    const meSecond = await request(app).get('/auth/me').set('Cookie', secondCookies);
    expect(meSecond.body.user?.username).toBe(username);

    const out = await request(app).post('/auth/logout').set('Cookie', secondCookies);
    expect(out.status).toBe(200);

    const meAfterLogout = await request(app).get('/auth/me').set('Cookie', secondCookies);
    expect(meAfterLogout.body.user).toBeNull();
  });
});
