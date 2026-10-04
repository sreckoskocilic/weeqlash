// @ts-check
import { test, expect, request as playwrightRequest } from '@playwright/test';
import { registerAndLogin as loginPlayer, BASE, openGame } from './e2e-helpers.js';

test('qlashique: real pool serves a question; quitting via HOME awards win to the opponent', async ({
  browser,
}) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });

  const { ctx: ctx1, page: p1 } = await loginPlayer(browser, 'e2e_qlas_p1');
  const { ctx: ctx2, page: p2 } = await loginPlayer(browser, 'e2e_qlas_p2');

  await openGame(p1, 'qlashique');
  await p1.locator('#btn-qlas-create').click();
  await expect(p1.locator('#qlas-code-val')).toHaveText(/^[A-Z0-9]{5}$/, { timeout: 8000 });
  const code = await p1.locator('#qlas-code-val').textContent();

  await api.post('/test/set-hp', { data: { hp: 20 } });

  await openGame(p2, 'qlashique');
  await p2.locator('#qlas-join-code').fill(code.trim());
  await p2.locator('#btn-qlas-start').click();

  await p1.locator('#qlas-decision-panel').waitFor({ state: 'visible', timeout: 10000 });
  await p1.locator('#btn-qlas-attack').click();
  await expect(p1.locator('.qlas-opt')).toHaveCount(4, { timeout: 5000 });

  await expect(p2.locator('#btn-home')).toBeVisible();
  p2.once('dialog', (dialog) => dialog.accept());
  await p2.locator('#btn-home').click();
  await expect(p2.locator('#screen-connect')).toBeVisible({ timeout: 5000 });
  await expect(p2.locator('#btn-home')).toBeHidden();

  await expect(p1.locator('#qlas-phase-gameover')).toBeVisible({ timeout: 10000 });
  const winnerText = await p1.locator('#qlas-winner-text').textContent();
  expect(winnerText).toMatch(/WIN/i);
  const reasonText = await p1.locator('#qlas-winner-reason').textContent();
  expect(reasonText?.toUpperCase()).toContain('DISCONNECT');

  await api.dispose();
  await ctx1.close();
  await ctx2.close();
});
