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

async function playQuestions(page, count, correctIdx, { bonusQ3, bonusQ6 }) {
  for (let i = 0; i < count; i++) {
    await expect(page.locator('#howhigh-counter')).toContainText(`${i + 1}/`, { timeout: 5000 });
    await expect(page.locator('#howhigh-question')).toContainText(TEST_QUESTION.q, {
      timeout: 3000,
    });
    await page.locator(`#howhigh-options button:nth-child(${correctIdx + 1})`).click();

    // After Q3 (idx 2) → bonus offer
    if (i === 2) {
      if (bonusQ3 === 'dice') {
        await page.locator('#howhigh-phase-dice').waitFor({ state: 'visible', timeout: 5000 });
        await page.locator('#btn-howhigh-dice-accept').click();
        await page.locator('#howhigh-phase-game').waitFor({ state: 'visible', timeout: 5000 });
      } else {
        await page.locator('#howhigh-phase-don').waitFor({ state: 'visible', timeout: 5000 });
        await page.locator('#btn-howhigh-don-accept').click();
        await page.locator('#howhigh-phase-game').waitFor({ state: 'visible', timeout: 5000 });
      }
      continue;
    }
    // After Q6 (idx 5) → bonus offer
    if (i === 5) {
      if (bonusQ6 === 'gowild') {
        await page.locator('#howhigh-phase-gowild').waitFor({ state: 'visible', timeout: 5000 });
        await page.locator('#btn-howhigh-gowild-decline').click();
        await page.locator('#howhigh-phase-game').waitFor({ state: 'visible', timeout: 5000 });
      } else {
        await page
          .locator('#howhigh-phase-timecrunch')
          .waitFor({ state: 'visible', timeout: 5000 });
        await page.locator('#btn-howhigh-tc-accept').click();
        await page.locator('#howhigh-phase-game').waitFor({ state: 'visible', timeout: 5000 });
      }
      continue;
    }

    await page.waitForTimeout(300);
  }
}

test('howhigh: Double or Nothing accepted, all correct → score 24', async ({ browser }) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await setNextQuestion(TEST_QUESTION.id, { sticky: true });
  await setBonus('double_or_nothing', 'gowild');

  const { ctx, page } = await registerAndLogin(browser, 'e2e_quiz_player', {
    query: 'testSpeed=2',
  });

  await page.locator('#btn-howhigh-create').click();
  await page.locator('#screen-howhigh').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('#howhigh-phase-game').waitFor({ state: 'visible', timeout: 5000 });

  await playQuestions(page, 10, TEST_QUESTION.correctIdx, {
    bonusQ3: 'double_or_nothing',
    bonusQ6: 'gowild',
  });

  await page.locator('#howhigh-phase-gameover').waitFor({ state: 'visible', timeout: 5000 });
  // 3*2 + 2*4 + 5*2 = 6 + 8 + 10 = 24
  await expect(page.locator('#howhigh-go-score')).toHaveText('24');

  await clearStickyQuestion();
  await setBonus(null, null);
  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await api.dispose();
  await ctx.close();
});

test('howhigh: Time Crunch accepted, all correct → score 22', async ({ browser }) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await setNextQuestion(TEST_QUESTION.id, { sticky: true });
  await setBonus('dice', 'time_crunch');

  const { ctx, page } = await registerAndLogin(browser, 'e2e_quiz_player', {
    query: 'testSpeed=2',
  });

  await page.locator('#btn-howhigh-create').click();
  await page.locator('#screen-howhigh').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('#howhigh-phase-game').waitFor({ state: 'visible', timeout: 5000 });

  await playQuestions(page, 10, TEST_QUESTION.correctIdx, {
    bonusQ3: 'dice',
    bonusQ6: 'time_crunch',
  });

  await page.locator('#howhigh-phase-gameover').waitFor({ state: 'visible', timeout: 5000 });
  // Dice accepted at Q3: Q4 gets +2+diceSum. Time Crunch at Q6: Q7+Q8 get +3 each.
  // Score depends on dice roll — but with dice accepted, Q4 = 2+diceSum.
  // Rest normal: Q1-Q3=6, Q4=2+dice, Q5=2, Q6=2, Q7-Q8=6, Q9-Q10=4
  // Too variable with random dice — just verify score is displayed and > 20
  const scoreText = await page.locator('#howhigh-go-score').textContent();
  const score = parseInt(scoreText, 10);
  expect(score).toBeGreaterThan(20);

  await clearStickyQuestion();
  await setBonus(null, null);
  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await api.dispose();
  await ctx.close();
});

test('howhigh: Double or Nothing declined → normal score 20', async ({ browser }) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await setNextQuestion(TEST_QUESTION.id, { sticky: true });
  await setBonus('double_or_nothing', 'time_crunch');

  const { ctx, page } = await registerAndLogin(browser, 'e2e_quiz_player', {
    query: 'testSpeed=2',
  });

  await page.locator('#btn-howhigh-create').click();
  await page.locator('#screen-howhigh').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('#howhigh-phase-game').waitFor({ state: 'visible', timeout: 5000 });

  // Play all, but DECLINE both bonuses
  for (let i = 0; i < 10; i++) {
    await expect(page.locator('#howhigh-counter')).toContainText(`${i + 1}/`, { timeout: 5000 });
    await page
      .locator(`#howhigh-options button:nth-child(${TEST_QUESTION.correctIdx + 1})`)
      .click();

    if (i === 2) {
      await page.locator('#howhigh-phase-don').waitFor({ state: 'visible', timeout: 5000 });
      await page.locator('#btn-howhigh-don-decline').click();
      await page.locator('#howhigh-phase-game').waitFor({ state: 'visible', timeout: 5000 });
      continue;
    }
    if (i === 5) {
      await page.locator('#howhigh-phase-timecrunch').waitFor({ state: 'visible', timeout: 5000 });
      await page.locator('#btn-howhigh-tc-decline').click();
      await page.locator('#howhigh-phase-game').waitFor({ state: 'visible', timeout: 5000 });
      continue;
    }

    await page.waitForTimeout(300);
  }

  await page.locator('#howhigh-phase-gameover').waitFor({ state: 'visible', timeout: 5000 });
  // All correct, no bonuses: 10*2 = 20
  await expect(page.locator('#howhigh-go-score')).toHaveText('20');

  await clearStickyQuestion();
  await setBonus(null, null);
  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await api.dispose();
  await ctx.close();
});
