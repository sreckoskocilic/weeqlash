// @ts-check
import { test, expect, request as playwrightRequest } from '@playwright/test';
import {
  TEST_QUESTION,
  registerAndLogin,
  setNextQuestion,
  clearStickyQuestion,
} from './e2e-helpers.js';

const BASE = 'http://localhost:3000';

// With sticky TEST_QUESTION (correctIdx=0) and declining both dice and GoWild,
// all 10 answers correct → 10 × +2 = 20.
const EXPECTED_SCORE_ALL_CORRECT = '20';

async function playAllQuestions(page, total, correctIdx) {
  for (let i = 0; i < total; i++) {
    await expect(page.locator('#howhigh-counter')).toHaveText(`${i + 1}/${total}`, {
      timeout: 5000,
    });
    await expect(page.locator('#howhigh-question')).toContainText(TEST_QUESTION.q, {
      timeout: 3000,
    });
    await page.locator(`#howhigh-options button:nth-child(${correctIdx + 1})`).click();

    // After Q3 (idx 2) → dice offer
    if (i === 2) {
      await page.locator('#howhigh-phase-dice').waitFor({ state: 'visible', timeout: 5000 });
      await page.locator('#btn-howhigh-dice-decline').click();
      await page.locator('#howhigh-phase-game').waitFor({ state: 'visible', timeout: 5000 });
      continue;
    }
    // After Q6 (idx 5) → gowild offer
    if (i === 5) {
      await page.locator('#howhigh-phase-gowild').waitFor({ state: 'visible', timeout: 5000 });
      await page.locator('#btn-howhigh-gowild-decline').click();
      await page.locator('#howhigh-phase-game').waitFor({ state: 'visible', timeout: 5000 });
      continue;
    }

    await page.waitForTimeout(500);
  }
}

test('howhigh: P1 plays 10 correct, gets challenge code', async ({ browser }) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await setNextQuestion(TEST_QUESTION.id, { sticky: true });

  const { ctx, page } = await registerAndLogin(browser, 'e2e_quiz_player', {
    query: 'testSpeed=2',
  });

  await page.locator('#btn-howhigh-create').click();
  await page.locator('#screen-howhigh').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('#howhigh-phase-game').waitFor({ state: 'visible', timeout: 5000 });

  await playAllQuestions(page, 10, TEST_QUESTION.correctIdx);

  await page.locator('#howhigh-phase-gameover').waitFor({ state: 'visible', timeout: 5000 });
  await expect(page.locator('#howhigh-go-score')).toHaveText(EXPECTED_SCORE_ALL_CORRECT);

  // Challenge code visible
  const codeEl = page.locator('#howhigh-challenge-code');
  await expect(codeEl).toBeVisible();
  const code = await codeEl.textContent();
  expect(code).toMatch(/^[A-Z0-9]{5}$/);

  await clearStickyQuestion();
  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await api.dispose();
  await ctx.close();
});

test('howhigh: P2 joins, plays same questions, sees head-to-head result', async ({ browser }) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await setNextQuestion(TEST_QUESTION.id, { sticky: true });

  // --- P1 plays ---
  const { ctx: ctx1, page: p1 } = await registerAndLogin(browser, 'e2e_quiz_player', {
    query: 'testSpeed=2',
  });
  await p1.locator('#btn-howhigh-create').click();
  await p1.locator('#howhigh-phase-game').waitFor({ state: 'visible', timeout: 5000 });
  await playAllQuestions(p1, 10, TEST_QUESTION.correctIdx);
  await p1.locator('#howhigh-phase-gameover').waitFor({ state: 'visible', timeout: 5000 });

  const code = await p1.locator('#howhigh-challenge-code').textContent();
  expect(code).toMatch(/^[A-Z0-9]{5}$/);

  // --- P2 joins ---
  const { ctx: ctx2, page: p2 } = await registerAndLogin(browser, 'e2e_qlas_p1', {
    query: 'testSpeed=2',
  });
  await p2.locator('#howhigh-join-code').fill(code);
  await p2.locator('#btn-howhigh-join').click();
  await p2.locator('#howhigh-phase-game').waitFor({ state: 'visible', timeout: 5000 });
  await playAllQuestions(p2, 10, TEST_QUESTION.correctIdx);
  await p2.locator('#howhigh-phase-gameover').waitFor({ state: 'visible', timeout: 5000 });

  // Both scored 20, tiebreaker by time → one wins
  await expect(p2.locator('#howhigh-go-score')).toHaveText(EXPECTED_SCORE_ALL_CORRECT);
  await expect(p2.locator('#howhigh-go-opponent-score')).toHaveText(EXPECTED_SCORE_ALL_CORRECT);
  const winnerText = await p2.locator('#howhigh-go-winner').textContent();
  expect(winnerText === 'YOU WIN!' || winnerText === 'YOU LOSE').toBe(true);

  await clearStickyQuestion();
  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await api.dispose();
  await ctx1.close();
  await ctx2.close();
});

test('howhigh: challenges tab shows completed challenge', async ({ browser }) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await setNextQuestion(TEST_QUESTION.id, { sticky: true });

  // P1 plays
  const { ctx: ctx1, page: p1 } = await registerAndLogin(browser, 'e2e_quiz_player', {
    query: 'testSpeed=2',
  });
  await p1.locator('#btn-howhigh-create').click();
  await p1.locator('#howhigh-phase-game').waitFor({ state: 'visible', timeout: 5000 });
  await playAllQuestions(p1, 10, TEST_QUESTION.correctIdx);
  await p1.locator('#howhigh-phase-gameover').waitFor({ state: 'visible', timeout: 5000 });
  const code = await p1.locator('#howhigh-challenge-code').textContent();

  // P2 plays
  const { ctx: ctx2, page: p2 } = await registerAndLogin(browser, 'e2e_qlas_p1', {
    query: 'testSpeed=2',
  });
  await p2.locator('#howhigh-join-code').fill(code);
  await p2.locator('#btn-howhigh-join').click();
  await p2.locator('#howhigh-phase-game').waitFor({ state: 'visible', timeout: 5000 });
  await playAllQuestions(p2, 10, TEST_QUESTION.correctIdx);
  await p2.locator('#howhigh-phase-gameover').waitFor({ state: 'visible', timeout: 5000 });

  // Go back to connect screen, then navigate to Challenges tab
  await p1.locator('#btn-howhigh-back').click();
  await p1.locator('[data-view="challenges"]').waitFor({ state: 'visible', timeout: 5000 });
  await p1.locator('[data-view="challenges"]').click();
  await p1.locator('#howhigh-challenges-list').waitFor({ state: 'visible', timeout: 5000 });
  await p1.waitForTimeout(500);

  // Should have at least one completed game row with scores
  const listText = await p1.locator('#howhigh-challenges-list').textContent();
  expect(listText).toContain('20');

  await clearStickyQuestion();
  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await api.dispose();
  await ctx1.close();
  await ctx2.close();
});
