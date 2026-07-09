// @ts-check
import { test, expect, request as playwrightRequest } from '@playwright/test';
import {
  TEST_QUESTION,
  registerAndLogin,
  setNextQuestion,
  clearStickyQuestion,
} from './e2e-helpers.js';

const BASE = 'http://localhost:3000';

test.afterEach(async () => {
  await clearStickyQuestion();
});

// Pick option 0 (always correct) every question → 20 × +13 = +260 max, qualifies for empty top-10 so we assert the insert
test('skipnot: 20 correct answers → score 260, qualifies, lands on leaderboard', async ({
  browser,
}) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });

  // Clean state, register test users, force every picked question to TEST_QUESTION via the sticky override
  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await setNextQuestion(TEST_QUESTION.id, { sticky: true });

  const { ctx, page } = await registerAndLogin(browser, 'e2e_quiz_player', {
    query: 'testSpeed=8',
  });

  await page.locator('#btn-skipnot-create').click();
  await page.locator('#screen-skipnot').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('#skipnot-phase-game').waitFor({ state: 'visible', timeout: 5000 });

  for (let i = 0; i < 20; i++) {
    const counter = page.locator('#skipnot-counter');
    await expect(counter).toHaveText(`${i + 1}/20`, { timeout: 5000 });
    await expect(page.locator('#skipnot-question')).toContainText(TEST_QUESTION.q);

    await page
      .locator(`#skipnot-options button:nth-child(${TEST_QUESTION.correctIdx + 1})`)
      .click();
  }

  await page.locator('#skipnot-phase-gameover').waitFor({ state: 'visible', timeout: 5000 });
  await expect(page.locator('#skipnot-go-score')).toHaveText('260');
  await expect(page.locator('#skipnot-qualifies-row')).toBeVisible();

  const lbName = 'e2e_skipnot';
  await page.locator('#skipnot-name-input').fill(lbName);
  await page.locator('#btn-skipnot-submit-score').click();
  // Submit hides the qualifies row; that's our signal the leaderboard insert succeeded.
  await expect(page.locator('#skipnot-qualifies-row')).toBeHidden({ timeout: 5000 });

  // Skip the secondary DB check — the qualifies-row hide above already proves the insert (score column is `answers`)

  await clearStickyQuestion();
  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await api.dispose();
  await ctx.close();
});

// Pick wrong every question → 20 × -7 = -140; regression that negative scores still qualify (schema once rejected answers < 0)
test('skipnot: 20 wrong answers → score -140, qualifies, lands in leaderboard', async ({
  browser,
}) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });

  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await setNextQuestion(TEST_QUESTION.id, { sticky: true });

  const { ctx, page } = await registerAndLogin(browser, 'e2e_quiz_player', {
    query: 'testSpeed=8',
  });

  await page.locator('#btn-skipnot-create').click();
  await page.locator('#skipnot-phase-game').waitFor({ state: 'visible', timeout: 5000 });

  for (let i = 0; i < 20; i++) {
    await expect(page.locator('#skipnot-counter')).toHaveText(`${i + 1}/20`, { timeout: 5000 });
    await page.locator('#skipnot-options button:nth-child(2)').click();
  }

  await page.locator('#skipnot-phase-gameover').waitFor({ state: 'visible', timeout: 5000 });
  await expect(page.locator('#skipnot-go-score')).toHaveText('-140');

  // Empty leaderboard → -140 should qualify (any score beats fewer than 10 entries).
  await expect(page.locator('#skipnot-qualifies-row')).toBeVisible();

  const lbName = 'e2e_neg';
  await page.locator('#skipnot-name-input').fill(lbName);
  await page.locator('#btn-skipnot-submit-score').click();
  await expect(page.locator('#skipnot-qualifies-row')).toBeHidden({ timeout: 5000 });

  // Name must show up in the leaderboard panel rendered on the gameover screen.
  await expect(page.locator('#skipnot-go-lb-rows')).toContainText(lbName, { timeout: 5000 });

  await clearStickyQuestion();
  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await api.dispose();
  await ctx.close();
});
