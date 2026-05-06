// @ts-check
// Qlashique e2e: verifies the HEAL outcome path (score >= 2 → choose heal → +2 HP).
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

test('qlashique: score >= 2 heal restores HP, opponent untouched', async ({ browser }) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });

  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await setNextQuestion(TEST_QUESTION.id, { sticky: true });

  const correctIdx = TEST_QUESTION.correctIdx; // 0
  const wrongIdx = 1;

  const { ctx: ctx1, page: p1 } = await registerAndLogin(browser, 'e2e_qlas_p1');
  const { ctx: ctx2, page: p2 } = await registerAndLogin(browser, 'e2e_qlas_p2');

  await p1.locator('#btn-qlas-create').click();
  await p1.waitForFunction(
    // eslint-disable-next-line no-undef
    () => document.getElementById('qlas-code-val')?.textContent?.trim().length === 5,
    { timeout: 8000 },
  );
  const code = await p1.locator('#qlas-code-val').textContent();

  await api.post('/test/set-hp', { data: { hp: 20 } });

  await p2.locator('#qlas-join-code').fill(code.trim());
  await p2.locator('#btn-qlas-start').click();

  // --- Turn 1 (P0): 4 wrong → score -4 → self-damage → HP 20→16 ---
  await p1.locator('#qlas-decision-panel').waitFor({ state: 'visible', timeout: 10000 });
  await p1.locator('#btn-qlas-attack').click();
  await p1.locator('#qlas-qpanel').waitFor({ state: 'visible', timeout: 5000 });

  for (let i = 0; i < 4; i++) {
    await p1.locator('.qlas-opt').nth(wrongIdx).click();
    if (i < 3) {
      await p1
        .locator('.qlas-opt:not([disabled])')
        .first()
        .waitFor({ state: 'visible', timeout: 5000 });
    }
  }
  await p1.waitForTimeout(300);

  await p1.locator('#btn-qlas-stop').click();
  await p1.locator('#btn-qlas-end').waitFor({ state: 'visible', timeout: 3000 });
  await p1.locator('#btn-qlas-end').click();

  // --- Turn 2 (P1): 1 wrong → score -1 → just advance quickly ---
  await p2.locator('#qlas-decision-panel').waitFor({ state: 'visible', timeout: 12000 });
  await p2.locator('#btn-qlas-attack').click();
  await p2.locator('#qlas-qpanel').waitFor({ state: 'visible', timeout: 5000 });
  await p2.locator('.qlas-opt').nth(wrongIdx).click();
  await p2.locator('#btn-qlas-stop').click();
  await p2.locator('#btn-qlas-end').waitFor({ state: 'visible', timeout: 3000 });
  await p2.locator('#btn-qlas-end').click();

  // --- Turn 3 (P0): 2 correct → score 2 → HEAL → +2 HP (16→18) ---
  await p1.locator('#qlas-decision-panel').waitFor({ state: 'visible', timeout: 12000 });
  await expect(p1.locator('#qlas-p0hp')).toHaveText('16', { timeout: 3000 });

  await p1.locator('#btn-qlas-attack').click();
  await p1.locator('#qlas-qpanel').waitFor({ state: 'visible', timeout: 5000 });

  // Correct answer 1
  await p1.locator('.qlas-opt').nth(correctIdx).click();
  await p1
    .locator('.qlas-opt:not([disabled])')
    .first()
    .waitFor({ state: 'visible', timeout: 5000 });

  // Correct answer 2
  await p1.locator('.qlas-opt').nth(correctIdx).click();
  await p1.waitForTimeout(300);

  // Stop → heal button visible (score >= 2)
  await p1.locator('#btn-qlas-stop').click();
  await p1.locator('#btn-qlas-heal').waitFor({ state: 'visible', timeout: 5000 });
  await p1.locator('#btn-qlas-heal').click();

  // Wait for P1's turn
  await p2.locator('#qlas-decision-panel').waitFor({ state: 'visible', timeout: 12000 });

  // P0 healed: 16 → 18 (+2 flat). P1 unchanged at 19.
  await expect(p1.locator('#qlas-p0hp')).toHaveText('18', { timeout: 3000 });
  await expect(p1.locator('#qlas-p1hp')).toHaveText('19', { timeout: 3000 });

  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await api.dispose();
  await ctx1.close();
  await ctx2.close();
});
