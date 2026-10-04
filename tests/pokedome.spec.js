// @ts-check
import { test, expect, request as playwrightRequest } from '@playwright/test';
import { registerAndLogin, openGame } from './e2e-helpers.js';

const BASE = 'http://localhost:3000';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

test('pokedome: three hangman puzzles → gameover + leaderboard', async ({ browser }) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});

  const { ctx, page } = await registerAndLogin(browser, 'e2e_quiz_player', {
    query: 'testSpeed=8',
  });

  await openGame(page, 'pokedome');
  await page.locator('#btn-pokedome-create').click();
  await page.locator('#pokedome-phase-game').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('#btn-pokedome-ready').click();
  await expect(page.locator('#btn-pokedome-ready')).toBeHidden();

  for (let puzzle = 1; puzzle <= 3; puzzle++) {
    await expect(page.locator('#pokedome-counter')).toHaveText(`${puzzle}/3`, { timeout: 5000 });
    await expect(page.locator('#pokedome-keys .pokedome-key')).toHaveCount(26);
    await expect(page.locator('#pokedome-word .pokedome-slot:not(.filled)').first()).toBeVisible();
    for (const letter of LETTERS) {
      if (await page.locator('#pokedome-status').textContent()) {
        break;
      }
      await page.keyboard.press(letter.toLowerCase());
      await page.waitForTimeout(20);
    }
    await expect(page.locator('#pokedome-status')).toHaveText('PUZZLE SOLVED');
    await expect(page.locator('#pokedome-word .pokedome-slot:not(.filled)')).toHaveCount(0);
  }

  await page.locator('#pokedome-phase-gameover').waitFor({ state: 'visible', timeout: 5000 });
  await expect(page.locator('#pokedome-go-score')).toHaveText(/^\d+$/);
  await expect(page.locator('#pokedome-go-results .pokedome-result')).toHaveCount(3);

  await expect(page.locator('#pokedome-qualifies-row')).toBeVisible();
  await page.locator('#pokedome-name-input').fill('e2e_dex');
  await page.locator('#btn-pokedome-submit-score').click();
  await expect(page.locator('#pokedome-go-lb-rows')).toContainText('e2e_dex', { timeout: 5000 });

  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await api.dispose();
  await ctx.close();
});
