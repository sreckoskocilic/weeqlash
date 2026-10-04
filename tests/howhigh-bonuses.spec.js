// @ts-check
import { test, expect, request as playwrightRequest } from '@playwright/test';
import {
  TEST_QUESTION,
  registerAndLogin,
  setNextQuestion,
  clearStickyQuestion,
} from './e2e-helpers.js';

const BASE = 'http://localhost:3000';

async function setBonus(bonusQ3, bonusQ6) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const res = await api.post('/test/set-howhigh-bonus', { data: { bonusQ3, bonusQ6 } });
  await api.dispose();
  if (!res.ok()) {
    throw new Error(`/test/set-howhigh-bonus failed: ${res.status()}`);
  }
}

test.afterEach(async () => {
  await clearStickyQuestion();
  await setBonus(null, null);
});

test('howhigh: Double or Nothing + Time Crunch accepted, all correct → score 26', async ({
  browser,
}) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await setNextQuestion(TEST_QUESTION.id, { sticky: true });
  await setBonus('double_or_nothing', 'time_crunch');

  const { ctx, page } = await registerAndLogin(browser, 'e2e_quiz_player', {
    query: 'testSpeed=8',
  });

  await page.locator('#btn-howhigh-create').click();
  await page.locator('#howhigh-phase-game').waitFor({ state: 'visible', timeout: 5000 });

  for (let i = 0; i < 10; i++) {
    await expect(page.locator('#howhigh-counter')).toContainText(`${i + 1}/`, { timeout: 5000 });
    await expect(page.locator('#howhigh-question')).toContainText(TEST_QUESTION.q, {
      timeout: 3000,
    });
    await page
      .locator(`#howhigh-options button:nth-child(${TEST_QUESTION.correctIdx + 1})`)
      .click();

    if (i === 2) {
      await page.locator('#howhigh-phase-don').waitFor({ state: 'visible', timeout: 5000 });
      await page.locator('#btn-howhigh-don-accept').click();
      await page.locator('#howhigh-phase-game').waitFor({ state: 'visible', timeout: 5000 });
    } else if (i === 5) {
      await page.locator('#howhigh-phase-timecrunch').waitFor({ state: 'visible', timeout: 5000 });
      await page.locator('#btn-howhigh-tc-accept').click();
      await page.locator('#howhigh-phase-game').waitFor({ state: 'visible', timeout: 5000 });
    }
  }

  await page.locator('#howhigh-phase-gameover').waitFor({ state: 'visible', timeout: 5000 });
  await expect(page.locator('#howhigh-go-score')).toHaveText('26');

  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await api.dispose();
  await ctx.close();
});
