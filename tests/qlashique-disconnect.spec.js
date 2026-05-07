// @ts-check
// Qlashique e2e: one player disconnects mid-game → other player sees game-over with 'disconnect' reason.
import { test, expect, request as playwrightRequest } from '@playwright/test';
import { registerAndLogin as loginPlayer, BASE } from './e2e-helpers.js';

test('qlashique: disconnect mid-game awards win to remaining player', async ({ browser }) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });

  const { ctx: ctx1, page: p1 } = await loginPlayer(browser, 'e2e_qlas_p1');
  const { ctx: ctx2, page: p2 } = await loginPlayer(browser, 'e2e_qlas_p2');

  await p1.locator('#btn-qlas-create').click();
  await expect(p1.locator('#qlas-code-val')).toHaveText(/^[A-Z0-9]{5}$/, { timeout: 8000 });
  const code = await p1.locator('#qlas-code-val').textContent();

  await api.post('/test/set-hp', { data: { hp: 20 } });

  await p2.locator('#qlas-join-code').fill(code.trim());
  await p2.locator('#btn-qlas-start').click();

  // Wait for game to start (P0's decision panel)
  await p1.locator('#qlas-decision-panel').waitFor({ state: 'visible', timeout: 10000 });

  // P2 disconnects by closing their browser context
  await ctx2.close();

  // P1 should see game-over with disconnect reason
  await expect(p1.locator('#qlas-phase-gameover')).toBeVisible({ timeout: 10000 });
  const winnerText = await p1.locator('#qlas-winner-text').textContent();
  expect(winnerText).toMatch(/WIN/i);
  const reasonText = await p1.locator('#qlas-winner-reason').textContent();
  expect(reasonText?.toUpperCase()).toContain('DISCONNECT');

  await api.dispose();
  await ctx1.close();
});
