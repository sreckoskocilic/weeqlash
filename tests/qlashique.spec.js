// @ts-check
import { test, expect, request as playwrightRequest } from '@playwright/test';
import { registerAndLogin as loginPlayer, BASE, openGame } from './e2e-helpers.js';

async function playTurn(page, api, qId, answerIdx) {
  await page.locator('#qlas-decision-panel').waitFor({ state: 'visible', timeout: 10000 });
  await api.post('/test/set-question', { data: { qId } });
  await page.locator('#btn-qlas-attack').click();
  await page.locator('#qlas-qpanel').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('.qlas-opt').nth(answerIdx).click();
  await page.locator('#btn-qlas-stop').click();
  await page.locator('#btn-qlas-end').click({ timeout: 3000 });
}

async function stats(api, user) {
  const s = await (await api.get(`/test/user-stats/${user}@test.invalid`)).json();
  const h = await (await api.get(`/test/game-history/${user}@test.invalid`)).json();
  return { played: s.games_played, won: s.games_won ?? 0, history: h.gamesPlayed };
}

test('qlashique: 3-HP game with live recap plays to a winner and records stats', async ({
  browser,
}) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });

  const sample = await (await api.get('/test/questions-sample')).json();
  expect(sample.length).toBeGreaterThan(0);
  const { qId, correctIdx } = sample[0];
  const wrongIdx = (correctIdx + 1) % 4;

  const p1Before = await stats(api, 'e2e_qlas_p1');
  const p2Before = await stats(api, 'e2e_qlas_p2');

  const { ctx: ctx1, page: p1 } = await loginPlayer(browser, 'e2e_qlas_p1', {
    query: 'testSpeed=8',
  });
  const { ctx: ctx2, page: p2 } = await loginPlayer(browser, 'e2e_qlas_p2', {
    query: 'testSpeed=8',
  });

  await openGame(p1, 'qlashique');
  await p1.locator('#btn-qlas-create').click();
  await expect(p1.locator('#qlas-code-val')).toHaveText(/^[A-Z0-9]{5}$/, { timeout: 8000 });
  const code = await p1.locator('#qlas-code-val').textContent();

  await api.post('/test/set-hp', { data: { hp: 3 } });
  await openGame(p2, 'qlashique');
  await p2.locator('#qlas-join-code').fill(code.trim());
  await p2.locator('#btn-qlas-start').click();

  await playTurn(p1, api, qId, correctIdx);
  await expect(p1.locator('#qlas-p1hp')).toHaveText('2', { timeout: 5000 });
  await playTurn(p2, api, qId, wrongIdx);
  await expect(p1.locator('#qlas-p1hp')).toHaveText('1', { timeout: 5000 });

  await p1.locator('#qlas-decision-panel').waitFor({ state: 'visible', timeout: 10000 });
  await p1.locator('#qlas-recap-live-btn').click();
  await p1.locator('#qlas-recap-modal.show').waitFor({ state: 'visible', timeout: 5000 });
  await expect(p1.locator('#qlas-recap-live .qlas-recap-empty')).toHaveCount(0);
  const cards = p1.locator('#qlas-recap-live .qlas-recap-card');
  await expect(cards).toHaveCount(2);

  const t1 = cards.nth(0);
  await expect(t1).toHaveClass(/\bp0\b/);
  await expect(t1).not.toHaveClass(/\bwrong\b/);
  await expect(t1.locator('.qlas-recap-turn')).toHaveText('T1');
  await expect(t1.locator('.qlas-recap-entry .ok')).toHaveCount(1);
  await expect(t1.locator('.qlas-recap-entry .bad')).toHaveCount(0);
  await expect(t1.locator('.qlas-recap-score')).toHaveText(/^\s*\+/);

  const t2 = cards.nth(1);
  await expect(t2).toHaveClass(/\bp1\b/);
  await expect(t2).toHaveClass(/\bwrong\b/);
  await expect(t2.locator('.qlas-recap-turn')).toHaveText('T2');
  await expect(t2.locator('.qlas-recap-entry .bad')).toHaveCount(1);
  await expect(t2.locator('.qlas-recap-score')).toHaveText(/^\s*-/);

  await p1.locator('#qlas-recap-modal-close').click();
  await playTurn(p1, api, qId, correctIdx);

  await expect(p1.locator('#qlas-phase-gameover')).toBeVisible({ timeout: 5000 });
  await expect(p2.locator('#qlas-phase-gameover')).toBeVisible({ timeout: 5000 });
  await expect(p1.locator('#qlas-winner-text')).toHaveText(/YOU WIN/i);
  await expect(p2.locator('#qlas-winner-text')).toHaveText(/WIN/i);

  const p1After = await stats(api, 'e2e_qlas_p1');
  const p2After = await stats(api, 'e2e_qlas_p2');
  expect(p1After.played).toBe(p1Before.played + 1);
  expect(p2After.played).toBe(p2Before.played + 1);
  expect(p1After.won).toBe(p1Before.won + 1);
  expect(p2After.won).toBe(p2Before.won);
  expect(p1After.history).toBe(p1Before.history + 1);

  await api.dispose();
  await ctx1.close();
  await ctx2.close();
});
