// @ts-check
// SkipNoT e2e: skip button scores 0 (no penalty, no gain). Mix of skips + correct + wrong.
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

// 10 correct (+130), 5 wrong (-35), 5 skips (0) = 95
test('skipnot: skip button scores 0, mixed run produces correct total', async ({ browser }) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });

  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await setNextQuestion(TEST_QUESTION.id, { sticky: true });

  const { ctx, page } = await registerAndLogin(browser, 'e2e_quiz_player');

  await page.locator('#btn-skipnot-create').click();
  await page.locator('#skipnot-phase-game').waitFor({ state: 'visible', timeout: 5000 });

  // Pattern: 10 correct, 5 wrong, 5 skip
  for (let i = 0; i < 20; i++) {
    await expect(page.locator('#skipnot-counter')).toHaveText(`${i + 1}/20`, { timeout: 5000 });

    if (i < 10) {
      // Correct: click option at correctIdx (0)
      await page
        .locator(`#skipnot-options button:nth-child(${TEST_QUESTION.correctIdx + 1})`)
        .click();
    } else if (i < 15) {
      // Wrong: click option 2 (index 1, always wrong for TEST_QUESTION)
      await page.locator('#skipnot-options button:nth-child(2)').click();
    } else {
      // Skip
      await page.locator('#btn-skipnot-skip').click();
    }
    await page.waitForTimeout(900);
  }

  await page.locator('#skipnot-phase-gameover').waitFor({ state: 'visible', timeout: 5000 });

  // 10×13 + 5×(-7) + 5×0 = 130 - 35 = 95
  await expect(page.locator('#skipnot-go-score')).toHaveText('95');

  // Heatmap should show 20 cells: 10 ok, 5 bad, 5 skip
  const okCells = page.locator('#skipnot-heatmap .hcell.ok');
  const badCells = page.locator('#skipnot-heatmap .hcell.bad');
  await expect(okCells).toHaveCount(10);
  await expect(badCells).toHaveCount(5);

  await clearStickyQuestion();
  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await api.dispose();
  await ctx.close();
});
