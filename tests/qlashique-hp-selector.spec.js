// @ts-check
// Qlashique e2e: verifies the HP selector UI sets game HP correctly.
import { test, expect, request as playwrightRequest } from '@playwright/test';
import {
  registerAndLogin,
  BASE,
  TEST_QUESTION,
  setNextQuestion,
  clearStickyQuestion,
} from './e2e-helpers.js';

test.afterEach(async () => {
  await clearStickyQuestion();
});

test('qlashique: HP selector sets game HP to 10', async ({ browser }) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await setNextQuestion(TEST_QUESTION.id, { sticky: true });

  const correctIdx = TEST_QUESTION.correctIdx;

  const { ctx: ctx1, page: p1 } = await registerAndLogin(browser, 'e2e_qlas_p1');
  const { ctx: ctx2, page: p2 } = await registerAndLogin(browser, 'e2e_qlas_p2');

  // Select HP 10 via UI before creating room
  await p1.locator('.qlas-hp-opt[data-hp="10"]').click();
  await expect(p1.locator('.qlas-hp-opt[data-hp="10"]')).toHaveClass(/selected/);

  await p1.locator('#btn-qlas-create').click();
  await p1.waitForFunction(
    // eslint-disable-next-line no-undef
    () => document.getElementById('qlas-code-val')?.textContent?.trim().length === 5,
    { timeout: 8000 },
  );
  const code = await p1.locator('#qlas-code-val').textContent();

  await p2.locator('#qlas-join-code').fill(code.trim());
  await p2.locator('#btn-qlas-start').click();

  // Wait for game to start — both players should see HP = 10
  await p1.locator('#qlas-decision-panel').waitFor({ state: 'visible', timeout: 10000 });

  await expect(p1.locator('#qlas-p0hp')).toHaveText('10');
  await expect(p1.locator('#qlas-p1hp')).toHaveText('10');
  await expect(p2.locator('#qlas-p0hp')).toHaveText('10');
  await expect(p2.locator('#qlas-p1hp')).toHaveText('10');

  // Play one correct answer turn to verify HP bar updates relative to maxHp=10
  await p1.locator('#btn-qlas-attack').click();
  await p1.locator('#qlas-qpanel').waitFor({ state: 'visible', timeout: 5000 });
  await p1.locator('.qlas-opt').nth(correctIdx).click();
  await p1.locator('#btn-qlas-stop').click();
  await p1.locator('#btn-qlas-end').waitFor({ state: 'visible', timeout: 3000 });
  await p1.locator('#btn-qlas-end').click();

  // P1 attacked with score 1 → P2 HP should be 9
  await p2.locator('#qlas-decision-panel').waitFor({ state: 'visible', timeout: 10000 });
  await expect(p1.locator('#qlas-p1hp')).toHaveText('9');

  await api.dispose();
  await ctx1.close();
  await ctx2.close();
});

test('qlashique: default HP selector is 15', async ({ browser }) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});

  const { ctx, page } = await registerAndLogin(browser, 'e2e_qlas_p1');

  // Default selected should be 15
  await expect(page.locator('.qlas-hp-opt.selected')).toHaveText('15');
  await expect(page.locator('.qlas-hp-opt.selected')).toHaveAttribute('data-hp', '15');

  // All 4 options present
  await expect(page.locator('.qlas-hp-opt')).toHaveCount(4);

  await api.dispose();
  await ctx.close();
});
