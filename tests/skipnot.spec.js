// @ts-check
import { test, expect, request as playwrightRequest } from '@playwright/test';
import {
  TEST_QUESTION,
  registerAndLogin,
  setNextQuestion,
  clearStickyQuestion,
  openGame,
} from './e2e-helpers.js';

const BASE = 'http://localhost:3000';

test.afterEach(async () => {
  await clearStickyQuestion();
});

test('skipnot: mixed run with skips → heatmap, qualifies, lands on leaderboard', async ({
  browser,
}) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });

  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await setNextQuestion(TEST_QUESTION.id, { sticky: true });

  const { ctx, page } = await registerAndLogin(browser, 'e2e_quiz_player', {
    query: 'testSpeed=8',
  });

  await openGame(page, 'skipnot');
  await page.locator('#btn-skipnot-create').click();
  await page.locator('#skipnot-phase-game').waitFor({ state: 'visible', timeout: 5000 });

  for (let i = 0; i < 20; i++) {
    await expect(page.locator('#skipnot-counter')).toHaveText(`${i + 1}/20`, { timeout: 5000 });

    if (i < 10) {
      await page
        .locator(`#skipnot-options button:nth-child(${TEST_QUESTION.correctIdx + 1})`)
        .click();
    } else if (i < 15) {
      await page.locator('#skipnot-options button:nth-child(2)').click();
    } else {
      await page.locator('#btn-skipnot-skip').click();
    }
  }

  await page.locator('#skipnot-phase-gameover').waitFor({ state: 'visible', timeout: 5000 });

  await expect(page.locator('#skipnot-go-score')).toHaveText('95');
  await expect(page.locator('#skipnot-heatmap .hcell.ok')).toHaveCount(10);
  await expect(page.locator('#skipnot-heatmap .hcell.bad')).toHaveCount(5);

  await expect(page.locator('#skipnot-qualifies-row')).toBeVisible();
  await page.locator('#skipnot-name-input').fill('e2e_skipnot');
  await page.locator('#btn-skipnot-submit-score').click();
  await expect(page.locator('#skipnot-qualifies-row')).toBeHidden({ timeout: 5000 });
  await expect(page.locator('#skipnot-go-lb-rows')).toContainText('e2e_skipnot', {
    timeout: 5000,
  });

  await clearStickyQuestion();
  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await api.dispose();
  await ctx.close();
});
