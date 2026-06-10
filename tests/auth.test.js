import { describe, it, expect, beforeAll } from 'vitest';
import './helpers/isolate-db.js';
import { initDb, getDb } from '../server/game/leaderboard.ts';
import {
  initAuthDb,
  createUser,
  authenticateUser,
  confirmEmail,
  createResetToken,
  resetPassword,
  resendConfirmation,
} from '../server/game/auth.ts';

let seq = 0;
function uniq() {
  return `u${process.pid}_${seq++}`;
}

async function makeUser({ email, confirmed = false } = {}) {
  const username = uniq();
  const addr = email ?? `${uniq()}@example.com`;
  const r = await createUser({
    username,
    email: addr,
    password: 'password1',
    autoConfirm: confirmed,
  });
  return { username, email: addr, userId: Number(r.userId), confirmToken: r.confirmToken };
}

beforeAll(() => {
  initDb();
  initAuthDb();
});

describe('createUser', () => {
  it('rejects a password under 8 characters', async () => {
    const r = await createUser({
      username: uniq(),
      email: `${uniq()}@example.com`,
      password: 'short',
    });
    expect(r).toEqual({ error: 'Password must be at least 8 characters' });
  });

  it('rejects a password over 128 characters', async () => {
    const r = await createUser({
      username: uniq(),
      email: `${uniq()}@example.com`,
      password: 'x'.repeat(129),
    });
    expect(r).toEqual({ error: 'Password must not exceed 128 characters' });
  });

  it('rejects a duplicate username', async () => {
    const name = uniq();
    await createUser({ username: name, email: `${uniq()}@example.com`, password: 'password1' });
    const r = await createUser({
      username: name,
      email: `${uniq()}@example.com`,
      password: 'password1',
    });
    expect(r).toEqual({ error: 'Registration failed' });
  });

  it('rejects a duplicate email', async () => {
    const email = `${uniq()}@example.com`;
    await createUser({ username: uniq(), email, password: 'password1' });
    const r = await createUser({ username: uniq(), email, password: 'password1' });
    expect(r).toEqual({ error: 'Registration failed' });
  });

  it('creates a user and returns a confirmation token', async () => {
    const r = await createUser({
      username: uniq(),
      email: `${uniq()}@example.com`,
      password: 'password1',
    });
    expect(r).toMatchObject({ ok: true });
    expect(r.userId).toBeTruthy();
    expect(r.confirmToken).toBeTruthy();
  });
});

describe('authenticateUser', () => {
  it('rejects an unknown user', async () => {
    expect(await authenticateUser('nobody_here', 'password1')).toEqual({
      error: 'Invalid credentials',
    });
  });

  it('rejects a wrong password', async () => {
    const u = await makeUser({ confirmed: true });
    expect(await authenticateUser(u.username, 'wrongpass1')).toEqual({
      error: 'Invalid credentials',
    });
  });

  it('rejects a blocked account', async () => {
    const u = await makeUser({ confirmed: true });
    getDb().prepare('UPDATE users SET is_blocked = 1 WHERE id = ?').run(u.userId);
    expect(await authenticateUser(u.username, 'password1')).toEqual({
      error: 'Account is blocked',
    });
  });

  it('blocks login until email is confirmed for a normal email', async () => {
    const u = await makeUser({ email: `${uniq()}@example.com` });
    expect(await authenticateUser(u.username, 'password1')).toMatchObject({
      error: 'Email not confirmed',
      needsConfirmation: true,
      userId: u.userId,
    });
  });

  it('bypasses confirmation for @test.invalid in non-production', async () => {
    const u = await makeUser({ email: `${uniq()}@test.invalid` });
    expect(await authenticateUser(u.username, 'password1')).toMatchObject({ ok: true });
  });

  it('authenticates a confirmed user', async () => {
    const u = await makeUser({ confirmed: true });
    expect(await authenticateUser(u.username, 'password1')).toMatchObject({
      ok: true,
      user: { username: u.username },
    });
  });
});

describe('confirmEmail', () => {
  it('confirms a valid token and nulls it', async () => {
    const u = await makeUser();
    expect(confirmEmail(u.confirmToken)).toEqual({ ok: true });
    const row = getDb()
      .prepare('SELECT email_confirmed, confirmation_token FROM users WHERE id = ?')
      .get(u.userId);
    expect(row.email_confirmed).toBe(1);
    expect(row.confirmation_token).toBeNull();
  });

  it('rejects an unknown token', () => {
    expect(confirmEmail('not-a-token')).toMatchObject({ error: expect.any(String) });
  });

  it('rejects an expired token', async () => {
    const u = await makeUser();
    getDb()
      .prepare('UPDATE users SET confirmation_token_expires = ? WHERE id = ?')
      .run(Date.now() - 1000, u.userId);
    expect(confirmEmail(u.confirmToken)).toMatchObject({ error: expect.any(String) });
  });
});

describe('createResetToken', () => {
  it('returns ok with no token for an unknown email', () => {
    const r = createResetToken('ghost@example.com');
    expect(r).toEqual({ ok: true });
    expect(r.resetToken).toBeUndefined();
  });

  it('issues a token for a known email', async () => {
    const u = await makeUser();
    const r = createResetToken(u.email);
    expect(r.ok).toBe(true);
    expect(r.resetToken).toBeTruthy();
  });
});

describe('resetPassword', () => {
  it('rejects an invalid token', async () => {
    expect(await resetPassword('bad-token', 'newpass12')).toMatchObject({
      error: expect.any(String),
    });
  });

  it('rejects an expired token', async () => {
    const u = await makeUser();
    const { resetToken } = createResetToken(u.email);
    getDb()
      .prepare('UPDATE users SET reset_token_expires = ? WHERE id = ?')
      .run(Date.now() - 1000, u.userId);
    expect(await resetPassword(resetToken, 'newpass12')).toMatchObject({
      error: expect.any(String),
    });
  });

  it('rejects a short new password on a valid token', async () => {
    const u = await makeUser();
    const { resetToken } = createResetToken(u.email);
    expect(await resetPassword(resetToken, 'short')).toMatchObject({ error: expect.any(String) });
  });

  it('resets the password, clears the token, and the new password authenticates', async () => {
    const u = await makeUser({ confirmed: true });
    const { resetToken } = createResetToken(u.email);
    expect(await resetPassword(resetToken, 'brandnew99')).toEqual({ ok: true });
    const row = getDb().prepare('SELECT reset_token FROM users WHERE id = ?').get(u.userId);
    expect(row.reset_token).toBeNull();
    expect(await authenticateUser(u.username, 'brandnew99')).toMatchObject({ ok: true });
    expect(await authenticateUser(u.username, 'password1')).toEqual({
      error: 'Invalid credentials',
    });
  });
});

describe('resendConfirmation', () => {
  it('rejects an unknown user', () => {
    expect(resendConfirmation(999999)).toEqual({ error: 'User not found' });
  });

  it('rejects an already-confirmed user', async () => {
    const u = await makeUser({ confirmed: true });
    expect(resendConfirmation(u.userId)).toEqual({ error: 'Email already confirmed' });
  });

  it('issues a fresh token for an unconfirmed user', async () => {
    const u = await makeUser();
    const r = resendConfirmation(u.userId);
    expect(r.ok).toBe(true);
    expect(r.confirmToken).toBeTruthy();
    expect(r.confirmToken).not.toBe(u.confirmToken);
  });
});
