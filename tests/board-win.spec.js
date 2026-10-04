// @ts-check
import { test, expect, request as playwrightRequest } from '@playwright/test';
import {
  TEST_QUESTION,
  BASE,
  setNextQuestion,
  clearStickyQuestion,
  startBoardGame,
  answerBoardQuestion,
} from './e2e-helpers.js';

test.afterEach(async () => {
  await clearStickyQuestion();
});

async function answeredCount(page) {
  const me = await (await page.request.get('/auth/me')).json();
  expect(me?.user?.id).toBeTruthy();
  const res = await page.request.get(`/auth/stats/${me.user.id}`);
  expect(res.ok()).toBe(true);
  return (await res.json()).totalAnswered || 0;
}

async function userStats(api, email) {
  const res = await api.get(`/test/user-stats/${email}`);
  expect(res.ok()).toBe(true);
  return res.json();
}

async function pegPos(page, pegId) {
  const tile = page.locator(`.tile:has(.peg[data-peg-id="${pegId}"])`);
  return {
    r: Number(await tile.getAttribute('data-r')),
    c: Number(await tile.getAttribute('data-c')),
  };
}

test('board: combat to a win records stats for both players', async ({ browser }) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const p1Email = 'e2e_normal_p1@test.invalid';
  const p2Email = 'e2e_normal_p2@test.invalid';
  const p1Initial = await userStats(api, p1Email);
  const p2Initial = await userStats(api, p2Email);

  const { ctx1, p1, ctx2, p2, code } = await startBoardGame(browser);
  const p1Answered = await answeredCount(p1);
  const p2Answered = await answeredCount(p2);
  await setNextQuestion(TEST_QUESTION.id, { sticky: true });

  const p1PegId = await p1.locator('.peg.can-move').first().getAttribute('data-peg-id');
  const p2PegId = await p1.locator('.peg[data-peg-id^="p1_"]').first().getAttribute('data-peg-id');
  const p2Pos = await pegPos(p1, p2PegId);
  const nextToP2 = { r: p2Pos.r, c: p2Pos.c - 1 };
  await api.post('/test/teleport-peg', {
    data: { code, pegId: p1PegId, row: nextToP2.r, col: nextToP2.c },
  });
  await expect(
    p1.locator(
      `.tile[data-r="${nextToP2.r}"][data-c="${nextToP2.c}"] .peg[data-peg-id="${p1PegId}"]`,
    ),
  ).toBeVisible({ timeout: 5000 });

  await p1.locator(`.peg[data-peg-id="${p1PegId}"]`).click();
  await p1
    .locator(`.tile.valid-move[data-r="${p2Pos.r}"][data-c="${p2Pos.c}"]`)
    .click({ timeout: 5000 });
  await answerBoardQuestion(p1, TEST_QUESTION.correctIdx === 0 ? 1 : 0);
  await expect(p1.locator('#modal-overlay')).not.toHaveClass(/visible/, { timeout: 5000 });

  await p2.locator(`.peg.can-move[data-peg-id="${p2PegId}"]`).click({ timeout: 8000 });
  await p2
    .locator(`.tile.valid-move[data-r="${nextToP2.r}"][data-c="${nextToP2.c}"]`)
    .click({ timeout: 5000 });
  for (let i = 0; i < 3; i++) {
    await answerBoardQuestion(p2, TEST_QUESTION.correctIdx);
  }

  await expect(p1.locator('#screen-gameover')).toBeVisible({ timeout: 10000 });
  await expect(p2.locator('#screen-gameover')).toBeVisible({ timeout: 10000 });

  const p1Delta = (await answeredCount(p1)) - p1Answered;
  const p2Delta = (await answeredCount(p2)) - p2Answered;
  expect(p1Delta).toBeGreaterThan(0);
  expect(p1Delta).toBeLessThanOrEqual(1);
  expect(p2Delta).toBeGreaterThan(0);
  expect(p2Delta).toBeLessThanOrEqual(3);

  const p1After = await userStats(api, p1Email);
  const p2After = await userStats(api, p2Email);
  expect(p1After.games_played).toBeGreaterThan(p1Initial.games_played);
  expect(p2After.games_played).toBeGreaterThan(p2Initial.games_played);
  expect(p2After.games_won ?? 0).toBeGreaterThan(p2Initial.games_won ?? 0);

  await api.dispose();
  await ctx1.close();
  await ctx2.close();
});
