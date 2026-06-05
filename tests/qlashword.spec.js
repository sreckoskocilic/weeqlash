// @ts-check
// Qlashword e2e: drives two real browser clients through the full playable
// loop — lobby (create → join → host start), board render, a scored word play
// with a trivia-gated bonus square, and turn handoff.
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

async function setRack(code, playerIdx, rack) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const res = await api.post('/test/qw-set-rack', { data: { code, playerIdx, rack } });
  await api.dispose();
  if (!res.ok()) {
    throw new Error(`/test/qw-set-rack failed: ${res.status()}`);
  }
}

test('qlashword: lobby → place QUIZ over center DW → unlock bonus → score 44', async ({
  browser,
}) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  // Every bonus question becomes the synthetic TEST_QUESTION (correct = idx 0).
  await setNextQuestion(TEST_QUESTION.id, { sticky: true });

  const { ctx: ctx1, page: p1 } = await registerAndLogin(browser, 'e2e_qlas_p1');
  const { ctx: ctx2, page: p2 } = await registerAndLogin(browser, 'e2e_qlas_p2');

  // Host creates a Qlashword room.
  await p1.locator('#btn-qlashword-create').click();
  await expect(p1.locator('#qw-code-val')).toHaveText(/^[A-Z0-9]{5}$/, { timeout: 8000 });
  const code = (await p1.locator('#qw-code-val').textContent()).trim();

  // Opponent joins by code.
  await p2.locator('#qlashword-join-code').fill(code);
  await p2.locator('#btn-qlashword-join').click();

  // Host sees the Start button once the room is full, then starts.
  await p1.locator('#qw-btn-start').waitFor({ state: 'visible', timeout: 8000 });
  // The host's create_room counts against the per-socket lobby rate limit
  // (1s); wait it out so the START click isn't throttled.
  await p1.waitForTimeout(1200);
  await p1.locator('#qw-btn-start').click();

  // Both reach the board; 15×15 = 225 cells render.
  await p1.locator('#qw-phase-game').waitFor({ state: 'visible', timeout: 10000 });
  await p2.locator('#qw-phase-game').waitFor({ state: 'visible', timeout: 10000 });
  await expect(p1.locator('.qw-cell')).toHaveCount(225);

  // Turn gating: host is on move, opponent is not.
  await expect(p1.locator('#qw-turn-indicator')).toHaveText(/YOUR TURN/);
  await expect(p2.locator('#qw-turn-indicator')).not.toHaveText(/YOUR TURN/);

  // Force the host's rack to a known set so we can play a real word.
  await setRack(code, 0, ['Q', 'U', 'I', 'Z', 'A', 'B', 'C']);
  await expect(p1.locator('.qw-rack-tile[data-idx="0"] .qw-tile-letter')).toHaveText('Q');

  // Place QUIZ horizontally across the center square (7,7)–(7,10) via click-to-place.
  const play = [
    [0, 7, 7],
    [1, 7, 8],
    [2, 7, 9],
    [3, 7, 10],
  ];
  for (const [idx, r, c] of play) {
    await p1.locator(`.qw-rack-tile[data-idx="${idx}"]`).click();
    await p1.locator(`.qw-cell[data-row="${r}"][data-col="${c}"]`).click();
  }
  await expect(p1.locator('.qw-cell-pending')).toHaveCount(4);

  // Submit → the center DW (a premium square) triggers one bonus square. The
  // player must opt in (ANSWER QUESTION) before the question is revealed.
  await p1.locator('#qw-btn-submit').click();
  await p1.locator('#qw-bonus-modal.show').waitFor({ state: 'visible', timeout: 8000 });
  await p1.locator('#qw-bonus-start-btn').click();
  await p1.locator('#qw-options .qlas-opt').first().waitFor({ state: 'visible', timeout: 8000 });

  // Answer correctly → unlock the double-word multiplier.
  await p1.locator('#qw-options .qlas-opt').nth(TEST_QUESTION.correctIdx).click();

  // QUIZ = 10+1+1+10 = 22, doubled by the unlocked DW = 44.
  await expect(p1.locator('#qw-p0score')).toHaveText('44', { timeout: 8000 });
  await expect(p2.locator('#qw-p0score')).toHaveText('44', { timeout: 8000 });

  // Settled tiles are on the board for both players.
  await expect(p1.locator('.qw-cell[data-row="7"][data-col="7"] .qw-tile-settled')).toBeVisible();
  await expect(p2.locator('.qw-cell[data-row="7"][data-col="7"] .qw-tile-settled')).toBeVisible();

  // Turn handed off to the opponent.
  await expect(p2.locator('#qw-turn-indicator')).toHaveText(/YOUR TURN/, { timeout: 8000 });
  await expect(p1.locator('#qw-turn-indicator')).not.toHaveText(/YOUR TURN/);

  await api.dispose();
  await ctx1.close();
  await ctx2.close();
});

test('qlashword: a player can pass and the turn advances', async ({ browser }) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});

  const { ctx: ctx1, page: p1 } = await registerAndLogin(browser, 'e2e_qlas_p1');
  const { ctx: ctx2, page: p2 } = await registerAndLogin(browser, 'e2e_qlas_p2');

  await p1.locator('#btn-qlashword-create').click();
  await expect(p1.locator('#qw-code-val')).toHaveText(/^[A-Z0-9]{5}$/, { timeout: 8000 });
  const code = (await p1.locator('#qw-code-val').textContent()).trim();

  await p2.locator('#qlashword-join-code').fill(code);
  await p2.locator('#btn-qlashword-join').click();
  await p1.locator('#qw-btn-start').waitFor({ state: 'visible', timeout: 8000 });
  // The host's create_room counts against the per-socket lobby rate limit
  // (1s); wait it out so the START click isn't throttled.
  await p1.waitForTimeout(1200);
  await p1.locator('#qw-btn-start').click();

  await p1.locator('#qw-phase-game').waitFor({ state: 'visible', timeout: 10000 });
  await expect(p1.locator('#qw-turn-indicator')).toHaveText(/YOUR TURN/);

  await p1.locator('#qw-btn-pass').click();
  await expect(p2.locator('#qw-turn-indicator')).toHaveText(/YOUR TURN/, { timeout: 8000 });
  await expect(p1.locator('#qw-turn-indicator')).not.toHaveText(/YOUR TURN/);

  await api.dispose();
  await ctx1.close();
  await ctx2.close();
});
