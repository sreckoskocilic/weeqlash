// @ts-check
import { test, expect, request as playwrightRequest } from '@playwright/test';
import { registerAndLogin } from './e2e-helpers.js';

const BASE = 'http://localhost:3000';

// Flow smoke test — correct set is secret/per-run, so we assert a numeric score + leaderboard insert, not an exact value
test('centographer: start → pick → submit → gameover + leaderboard', async ({ browser }) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});

  const { ctx, page } = await registerAndLogin(browser, 'e2e_quiz_player');

  await page.locator('#btn-cento-create').click();
  await page.locator('#screen-centographer').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('#cento-phase-game').waitFor({ state: 'visible', timeout: 5000 });

  // A country outline and a full grid of choices should render.
  await expect(page.locator('#cento-img')).toBeVisible();
  const choices = page.locator('#cento-choices .cento-choice');
  await expect(choices).toHaveCount(60, { timeout: 5000 });

  // Tick the first five choices; the selected counter tracks them.
  for (let i = 0; i < 5; i++) {
    await choices.nth(i).click();
  }
  await expect(page.locator('#cento-count')).toHaveText('5');

  await page.locator('#btn-cento-submit').click();

  // Gameover: score is an integer (can be negative — no lower floor).
  await page.locator('#cento-phase-gameover').waitFor({ state: 'visible', timeout: 5000 });
  await expect(page.locator('#cento-go-score')).toHaveText(/^-?\d+$/, { timeout: 5000 });
  await expect(page.locator('#cento-go-wrong')).toHaveText(/^\d+$/);

  // Empty leaderboard → this run qualifies; submitting the name lands it.
  await expect(page.locator('#cento-qualifies-row')).toBeVisible();
  const lbName = 'e2e_cento';
  await page.locator('#cento-name-input').fill(lbName);
  await page.locator('#btn-cento-submit-score').click();
  await expect(page.locator('#cento-go-lb-rows')).toContainText(lbName, { timeout: 5000 });

  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await api.dispose();
  await ctx.close();
});
