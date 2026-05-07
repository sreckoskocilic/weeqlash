import { request } from '@playwright/test';
import { execSync } from 'child_process';

const BASE = 'http://localhost:3000';

export default async function globalSetup() {
  // Flush Redis test DB so each run starts clean. DB 1 is reserved for e2e
  // (see playwright.config.js webServer REDIS_URL); dev uses DB 0.
  // Safe no-op if Redis isn't running yet — server does not depend on it yet.
  try {
    execSync('redis-cli -n 1 FLUSHDB', { stdio: 'ignore', timeout: 2000 });
  } catch {
    // redis-cli missing or Redis down — ignore.
  }

  const api = await request.newContext({ baseURL: BASE });
  const res = await api.post('/test/setup-users').catch((e) => {
    console.error('[e2e-setup] /test/setup-users failed:', e.message);
    return null;
  });
  if (res && !res.ok()) {
    console.error(`[e2e-setup] /test/setup-users returned ${res.status()}`);
  }
  await api.dispose();
}
