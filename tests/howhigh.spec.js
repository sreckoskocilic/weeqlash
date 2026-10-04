// @ts-check
import { test, expect, request as playwrightRequest } from '@playwright/test';
import {
  TEST_QUESTION,
  registerAndLogin,
  setNextQuestion,
  clearStickyQuestion,
  openGame,
} from './e2e-helpers.js';

const BASE = 'http://localhost:3000';

async function setBonus(bonusQ3, bonusQ6) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  await api.post('/test/set-howhigh-bonus', { data: { bonusQ3, bonusQ6 } });
  await api.dispose();
}

test.afterEach(async () => {
  await clearStickyQuestion();
  await setBonus(null, null);
});

const EXPECTED_SCORE_ALL_CORRECT = '20';

const DECLINE = {
  dice: ['#howhigh-phase-dice', '#btn-howhigh-dice-decline'],
  double_or_nothing: ['#howhigh-phase-don', '#btn-howhigh-don-decline'],
  gowild: ['#howhigh-phase-gowild', '#btn-howhigh-gowild-decline'],
  time_crunch: ['#howhigh-phase-timecrunch', '#btn-howhigh-tc-decline'],
};

async function playAllQuestions(page, total, correctIdx, [bonusQ3, bonusQ6]) {
  for (let i = 0; i < total; i++) {
    await expect(page.locator('#howhigh-counter')).toHaveText(`${i + 1}/${total}`, {
      timeout: 5000,
    });
    await expect(page.locator('#howhigh-question')).toContainText(TEST_QUESTION.q, {
      timeout: 3000,
    });
    await page.locator(`#howhigh-options button:nth-child(${correctIdx + 1})`).click();

    const offer = i === 2 ? bonusQ3 : i === 5 ? bonusQ6 : null;
    if (offer) {
      const [phase, declineBtn] = DECLINE[offer];
      await page.locator(phase).waitFor({ state: 'visible', timeout: 5000 });
      await page.locator(declineBtn).click();
      await page.locator('#howhigh-phase-game').waitFor({ state: 'visible', timeout: 5000 });
    }
  }
}

test('howhigh: P1 run → challenge code → P2 head-to-head → challenges list', async ({
  browser,
}) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await setNextQuestion(TEST_QUESTION.id, { sticky: true });
  await setBonus('dice', 'gowild');

  const { ctx: ctx1, page: p1 } = await registerAndLogin(browser, 'e2e_quiz_player', {
    query: 'testSpeed=8',
  });
  await openGame(p1, 'howhigh');
  await p1.locator('#btn-howhigh-create').click();
  await p1.locator('#howhigh-phase-game').waitFor({ state: 'visible', timeout: 5000 });
  await playAllQuestions(p1, 10, TEST_QUESTION.correctIdx, ['dice', 'gowild']);
  await p1.locator('#howhigh-phase-gameover').waitFor({ state: 'visible', timeout: 5000 });
  await expect(p1.locator('#howhigh-go-score')).toHaveText(EXPECTED_SCORE_ALL_CORRECT);
  await expect(p1.locator('#howhigh-challenge-code')).toBeVisible();
  const code = await p1.locator('#howhigh-challenge-code').textContent();
  expect(code).toMatch(/^[A-Z0-9]{5}$/);

  const { ctx: ctx2, page: p2 } = await registerAndLogin(browser, 'e2e_qlas_p1', {
    query: 'testSpeed=8',
  });
  await setBonus('double_or_nothing', 'time_crunch');
  await openGame(p2, 'howhigh');
  await p2.locator('#howhigh-join-code').fill(code);
  await p2.locator('#btn-howhigh-join').click();
  await p2.locator('#howhigh-phase-game').waitFor({ state: 'visible', timeout: 5000 });
  await playAllQuestions(p2, 10, TEST_QUESTION.correctIdx, ['double_or_nothing', 'time_crunch']);
  await p2.locator('#howhigh-phase-gameover').waitFor({ state: 'visible', timeout: 5000 });
  await expect(p2.locator('#howhigh-go-score')).toHaveText(EXPECTED_SCORE_ALL_CORRECT);
  await expect(p2.locator('#howhigh-go-opponent-score')).toHaveText(EXPECTED_SCORE_ALL_CORRECT);
  await expect(p2.locator('#howhigh-go-winner')).toHaveText(/^(YOU WIN!|YOU LOSE)$/);

  await p1.locator('#btn-home').click();
  await p1.locator('[data-view="challenges"]').waitFor({ state: 'visible', timeout: 5000 });
  await p1.locator('[data-view="challenges"]').click();
  await expect(p1.locator('#howhigh-challenges-list')).toContainText('20', { timeout: 5000 });

  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await api.dispose();
  await ctx1.close();
  await ctx2.close();
});
