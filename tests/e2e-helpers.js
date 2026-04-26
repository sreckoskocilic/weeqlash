// @ts-check
// Shared Playwright helpers for weeqlash e2e specs.
// Requires the server to run with ENABLE_TEST_ROUTES=1 (see playwright.config.js).

import { request as playwrightRequest } from '@playwright/test';

export const BASE = 'http://localhost:3000';

// Synthetic test question injected by the server when ENABLE_TEST_ROUTES=1.
// Must match the TEST_QUESTION block in server/index.js.
export const TEST_QUESTION = {
  id: 'TEST_Q_CORRECT_A',
  q: 'I am test question',
  opts: ['Correct', 'Wrong', 'Wrong', 'Wrong'],
  correctIdx: 0,
};

export async function registerAndLogin(browser, username) {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.waitForTimeout(500);
  // The horizontal nav defaults to the Play view; reveal the login form first.
  await page.locator('[data-view="login"]').click();
  await page.locator('#login-username').fill(username);
  await page.locator('#login-password').fill('testpass123');
  await page.locator('#btn-login').click();
  // Logged in → applyAuthState shows Sign out and routes back to Play.
  await page.locator('#btn-logout').waitFor({ state: 'visible', timeout: 5000 });
  return { ctx, page };
}

// Lock the next board-mode question picked by the server to the given qId.
// Defaults to the synthetic TEST_QUESTION so tests can assert correct-answer UI.
// Pass { sticky: true } to persist across picks; pair with clearStickyQuestion()
// in test.afterEach to avoid bleeding into later specs.
export async function setNextQuestion(qId = TEST_QUESTION.id, { sticky = false } = {}) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const res = await api.post('/test/set-question', { data: { qId, sticky } });
  await api.dispose();
  if (!res.ok()) {
    throw new Error(`/test/set-question failed: ${res.status()}`);
  }
}

export async function clearStickyQuestion() {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const res = await api.post('/test/clear-sticky-question');
  await api.dispose();
  if (!res.ok()) {
    throw new Error(`/test/clear-sticky-question failed: ${res.status()}`);
  }
}
