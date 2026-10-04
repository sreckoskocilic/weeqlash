// @ts-check
import { test, expect, request as playwrightRequest } from '@playwright/test';
import { registerAndLogin, BASE } from './e2e-helpers.js';

test('qlashique: HP selector defaults to 15 and the picked HP reaches both players', async ({
  browser,
}) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});

  const { ctx: ctx1, page: p1 } = await registerAndLogin(browser, 'e2e_qlas_p1');
  const { ctx: ctx2, page: p2 } = await registerAndLogin(browser, 'e2e_qlas_p2');

  await expect(p1.locator('.qlas-hp-opt')).toHaveCount(4);
  await expect(p1.locator('.qlas-hp-opt.selected')).toHaveAttribute('data-hp', '15');

  await p1.locator('.qlas-hp-opt[data-hp="10"]').click();
  await expect(p1.locator('.qlas-hp-opt[data-hp="10"]')).toHaveClass(/selected/);

  await p1.locator('#btn-qlas-create').click();
  await expect(p1.locator('#qlas-code-val')).toHaveText(/^[A-Z0-9]{5}$/, { timeout: 8000 });
  const code = await p1.locator('#qlas-code-val').textContent();

  await p2.locator('#qlas-join-code').fill(code.trim());
  await p2.locator('#btn-qlas-start').click();

  await p1.locator('#qlas-decision-panel').waitFor({ state: 'visible', timeout: 10000 });
  for (const page of [p1, p2]) {
    await expect(page.locator('#qlas-p0hp')).toHaveText('10');
    await expect(page.locator('#qlas-p1hp')).toHaveText('10');
  }

  await api.dispose();
  await ctx1.close();
  await ctx2.close();
});
