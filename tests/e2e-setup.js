import { request } from '@playwright/test';
import Database from 'better-sqlite3';
import { resolve } from 'path';

const DB_PATH = resolve('./server/data/leaderboard.db');
const BASE = 'http://localhost:3000';
const TEST_USERS = ['e2e_attacker', 'e2e_defender'];

export default async function globalSetup() {
  const api = await request.newContext({ baseURL: BASE });

  for (const username of TEST_USERS) {
    await api.post('/auth/register', {
      data: { username, email: `${username}@test.invalid`, password: 'testpass123' },
    });
  }

  await api.dispose();

  // Confirm emails directly in DB
  const db = new Database(DB_PATH);
  db.prepare(
    `UPDATE users SET email_confirmed = 1 WHERE username IN (${TEST_USERS.map(() => '?').join(',')})`
  ).run(...TEST_USERS);
  db.close();
}
