// @ts-check
import { test, expect, request as playwrightRequest } from '@playwright/test';
import { registerAndLogin as loginPlayer, BASE, openGame } from './e2e-helpers.js';

test('qlashique: idle turns auto-start, cost 2 HP, second in a row forfeits', async ({
  browser,
}) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });

  const { ctx: ctx1, page: p1 } = await loginPlayer(browser, 'e2e_qlas_p1');
  const { ctx: ctx2, page: p2 } = await loginPlayer(browser, 'e2e_qlas_p2');

  await openGame(p1, 'qlashique');
  await p1.locator('#btn-qlas-create').click();
  await expect(p1.locator('#qlas-code-val')).toHaveText(/^[A-Z0-9]{5}$/, { timeout: 8000 });
  const code = await p1.locator('#qlas-code-val').textContent();

  await api.post('/test/set-hp', { data: { hp: 15 } });
  await api.post('/test/set-qlas-timers', { data: { seconds: 2 } });

  await openGame(p2, 'qlashique');
  await p2.locator('#qlas-join-code').fill(code.trim());
  await p2.locator('#btn-qlas-start').click();

  await expect(p1.locator('#qlas-qpanel')).toBeVisible({ timeout: 5000 });
  await expect(p1.locator('#qlas-p0hp')).toHaveText('13', { timeout: 8000 });

  await p2.locator('#btn-qlas-stop').click({ timeout: 8000 });
  await p2.locator('#btn-qlas-end').click({ timeout: 5000 });
  await expect(p2.locator('#qlas-p1hp')).toHaveText('15');

  await expect(p2.locator('#qlas-phase-gameover')).toBeVisible({ timeout: 10000 });
  await expect(p2.locator('#qlas-winner-text')).toHaveText(/YOU WIN/i);
  await expect(p2.locator('#qlas-winner-reason')).toContainText('AFK');
  await expect(p1.locator('#qlas-winner-reason')).toContainText('AFK');

  await api.dispose();
  await ctx1.close();
  await ctx2.close();
});
