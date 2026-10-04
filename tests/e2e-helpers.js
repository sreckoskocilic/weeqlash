// @ts-check
// Shared Playwright e2e helpers — require the server running with ENABLE_TEST_ROUTES=1

import { expect, request as playwrightRequest } from '@playwright/test';

export const BASE = 'http://localhost:3000';

// Synthetic test question (ENABLE_TEST_ROUTES=1) — must match the TEST_QUESTION block in server/index.js
export const TEST_QUESTION = {
  id: 'TEST_Q_CORRECT_A',
  q: 'I am test question',
  opts: ['Correct', 'Wrong', 'Wrong', 'Wrong'],
  correctIdx: 0,
};

export async function registerAndLogin(browser, username, { query = '' } = {}) {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto(query ? `/?${query}` : '/');
  await page.locator('[data-view="login"]').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('[data-view="login"]').click();
  await page.locator('#login-username').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('#login-username').fill(username);
  await page.locator('#login-password').fill('testpass123');
  await page.locator('#btn-login').click();
  // Logged in → applyAuthState shows Sign out and routes back to Play.
  await page.locator('#btn-logout').waitFor({ state: 'visible', timeout: 5000 });
  return { ctx, page };
}

// Lock the next picked question to qId (default TEST_QUESTION); { sticky: true } persists across picks — clear it in afterEach
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

export async function openGame(page, game) {
  await page.locator(`[data-game="${game}"]`).click();
}

export async function startBoardGame(browser) {
  const { ctx: ctx1, page: p1 } = await registerAndLogin(browser, 'e2e_normal_p1', {
    query: 'testSpeed=8',
  });
  const { ctx: ctx2, page: p2 } = await registerAndLogin(browser, 'e2e_normal_p2', {
    query: 'testSpeed=8',
  });

  await openGame(p1, 'brawl');
  await p1.locator('[data-val="4"]').click();
  const createdAt = Date.now();
  await p1.locator('#btn-create').click();
  await p1.locator('#screen-lobby').waitFor({ timeout: 5000 });
  const code = await p1.locator('#lobby-code').innerText();

  await openGame(p2, 'brawl');
  await p2.locator('#join-code').fill(code);
  await p2.locator('#btn-join').click();
  await p2.locator('#screen-lobby').waitFor({ timeout: 5000 });

  await p1.locator('#btn-start:not([disabled])').waitFor({ timeout: 8000 });
  // Lobby rate limit is 1000ms per socket between room:create and room:start.
  await p1.waitForTimeout(Math.max(0, 1100 - (Date.now() - createdAt)));
  await p1.locator('#btn-start').click();
  await p1.locator('#screen-game').waitFor({ timeout: 8000 });
  await p2.locator('#screen-game').waitFor({ timeout: 8000 });

  return { ctx1, p1, ctx2, p2, code };
}

// Server rejects board answers sooner than MIN_ANSWER_DELAY_MS (300ms) after the question opens.
export async function answerBoardQuestion(page, optionIdx) {
  await page.locator('#modal-overlay.visible').waitFor({ timeout: 5000 });
  const option = page.locator('#modal-options .modal-option').nth(optionIdx);
  await expect(option).toBeEnabled({ timeout: 5000 });
  await page.waitForTimeout(350);
  await option.click();
  await expect(option).toBeDisabled({ timeout: 5000 });
  return option;
}
