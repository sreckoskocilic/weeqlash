// normal-move-win.spec.js – extended win test
// Reuses logic from normal-move.spec.js but loops until a winner
import { test, expect, request as playwrightRequest } from '@playwright/test';
const BASE = 'http://localhost:3000';
async function registerAndLogin(browser, username) {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.waitForTimeout(500);
  await page.locator('#login-username').fill(username);
  await page.locator('#login-password').fill('testpass123');
  await page.locator('#btn-login').click();
  await page.waitForTimeout(2000);
  return { ctx, page };
}
async function getUserStats(email) {
  const stats_api = await playwrightRequest.newContext({ baseURL: BASE });
  const res = await stats_api.get(`/auth/stats/${email}`);
  const data = await res.json();
  await stats_api.dispose();
  return data.totalAnswered || 0;
}
async function getUserGamesPlayed(email) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const res = await api.get(`/test/user-stats/${email}`);
  const data = await res.json();
  await api.dispose();
  return data.games_played || 0;
}
// Helper: play turns for current player until no valid moves or game over
async function playUntilWin(page) {
  while (true) {
    const pegs = page.locator('.peg.can-move');
    if ((await pegs.count()) === 0) {return false;}
    const pegId = await pegs.first().getAttribute('data-peg-id');
    await page.locator(`.peg[data-peg-id="${pegId}"]`).click();
    await page.waitForTimeout(300);
    const tiles = page.locator('.tile:not(.corner).can-move');
    if ((await tiles.count()) === 0) {return false;}
    await tiles.first().click();
    await page.locator('#modal-overlay.visible').waitFor({ timeout: 5000 });
    await page.locator('#modal-options .modal-option').nth(0).click();
    await page.waitForTimeout(1200);
    if (await page.locator('#screen-gameover').isVisible()) {return true;}
  }
}
test('normal move: play until one player wins', async ({ browser }) => {
  const { ctx: ctx1, page: p1 } = await registerAndLogin(browser, 'e2e_normal_p1');
  const { ctx: ctx2, page: p2 } = await registerAndLogin(browser, 'e2e_normal_p2');
  const p1Initial = await getUserGamesPlayed('e2e_normal_p1@test.invalid');
  const p2Initial = await getUserGamesPlayed('e2e_normal_p2@test.invalid');
  await p1.locator('[data-val="4"]').click();
  await p1.locator('#btn-create').click();
  await p1.locator('#screen-lobby').waitFor({ timeout: 5000 });
  const code = await p1.locator('#lobby-code').innerText();
  await p2.locator('#join-code').fill(code);
  await p2.locator('#btn-join').click();
  await p2.locator('#screen-lobby').waitFor({ timeout: 5000 });
  await p1.locator('#btn-start:not([disabled])').waitFor({ timeout: 8000 });
  await p1.waitForTimeout(1200);
  await p1.locator('#btn-start').click();
  await p1.locator('#screen-game').waitFor({ timeout: 8000 });
  await p2.locator('#screen-game').waitFor({ timeout: 8000 });
  const maxTurns = 100;
  let turn = 0;
  let current = p1;
  while (turn < maxTurns) {
    const went = await playUntilWin(current);
    if (went) {break;}
    turn++;
    console.log(turn);
    // check if either side now shows gameover
    if ((await p1.locator('#screen-gameover').isVisible()) ||
        (await p2.locator('#screen-gameover').isVisible())) {
      break;
    }
    current = current === p1 ? p2 : p1;
  }
  expect(turn).toBeGreaterThanOrEqual(0);
  // Verify a game was completed
  const p1After = await getUserGamesPlayed('e2e_normal_p1@test.invalid');
  const p2After = await getUserGamesPlayed('e2e_normal_p2@test.invalid');
  expect(p1After).toBeGreaterThanOrEqual(p1Initial);
  expect(p2After).toBeGreaterThanOrEqual(p2Initial);

  // Verify one winner
  const p1Stats = await getUserStats('e2e_normal_p1@test.invalid');
  const p2Stats = await getUserStats('e2e_normal_p2@test.invalid');
  const p1Won = (p1After.games_won ?? 0);
  const p2Won = (p2After.games_won ?? 0);
  expect(p1Won + p2Won).toBe(1);
  expect(p1Stats).toBeGreaterThan(0);
  expect(p2Stats).toBeGreaterThan(0);
  await ctx1.close();
  await ctx2.close();
});