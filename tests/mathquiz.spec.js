// @ts-check
import { test, expect, request as playwrightRequest } from '@playwright/test';
import { registerAndLogin } from './e2e-helpers.js';

const BASE = 'http://localhost:3000';

// MathQ is a solo, 10-question numeric-input mode with procedurally generated
// problems, so (like CentoGrapher) there's no fixed answer key to assert an
// exact score against. Flow smoke test: play all ten questions (typing 0 each
// time), reach the gameover screen with a numeric score, and land the run on the
// empty leaderboard.
test('mathquiz: play 10 questions → gameover + leaderboard', async ({ browser }) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});

  // testSpeed=2 shortens the between-question result flash.
  const { ctx, page } = await registerAndLogin(browser, 'e2e_quiz_player', {
    query: 'testSpeed=2',
  });

  await page.locator('#btn-mathquiz-create').click();
  await page.locator('#screen-mathquiz').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('#mathquiz-phase-game').waitFor({ state: 'visible', timeout: 5000 });

  for (let i = 0; i < 10; i++) {
    await expect(page.locator('#mathquiz-counter')).toHaveText(`${i + 1}/10`, { timeout: 5000 });
    await expect(page.locator('#mathquiz-prompt')).not.toBeEmpty();
    await page.locator('#mathquiz-input').fill('0');
    await page.locator('#btn-mathquiz-submit').click();
    await page.waitForTimeout(600);
  }

  // Gameover: a numeric score (can be 0 / negative / fractional) and a duration.
  await page.locator('#mathquiz-phase-gameover').waitFor({ state: 'visible', timeout: 5000 });
  await expect(page.locator('#mathquiz-go-score')).toHaveText(/-?\d/, { timeout: 5000 });
  await expect(page.locator('#mathquiz-go-duration')).not.toHaveText('—');

  // Empty leaderboard → the run qualifies; submitting the name lands it and the
  // submit button hides as confirmation.
  await expect(page.locator('#mathquiz-qualifies-row')).toBeVisible();
  await page.locator('#mathquiz-name-input').fill('e2e_mathq');
  await page.locator('#btn-mathquiz-submit-score').click();
  await expect(page.locator('#btn-mathquiz-submit-score')).toBeHidden({ timeout: 5000 });

  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await api.dispose();
  await ctx.close();
});
