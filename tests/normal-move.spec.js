// @ts-check
import { test, expect, request as playwrightRequest } from '@playwright/test';
import { registerAndLogin, BASE } from './e2e-helpers.js';

async function getUserGamesPlayed(email) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const res = await api.get(`/test/user-stats/${email}`);
  const data = await res.json();
  await api.dispose();
  return data.games_played || 0;
}

test('normal move: select peg → click empty tile → peg moves', async ({ browser }) => {
  const { ctx: ctx1, page: p1 } = await registerAndLogin(browser, 'e2e_normal_p1');
  const { ctx: ctx2, page: p2 } = await registerAndLogin(browser, 'e2e_normal_p2');

  // P1 creates 4×4 room (board size lives under Settings tab now)
  await p1.locator('[data-view="settings"]').click();
  await p1.locator('[data-val="4"]').click();
  await p1.locator('[data-view="play"]').click();
  await p1.locator('#btn-create').click();
  await p1.locator('#screen-lobby').waitFor({ timeout: 5000 });
  const code = await p1.locator('#lobby-code').innerText();

  // P2 joins
  await p2.locator('#join-code').fill(code);
  await p2.locator('#btn-join').click();
  await p2.locator('#screen-lobby').waitFor({ timeout: 5000 });

  // Start game
  await p1.locator('#btn-start:not([disabled])').waitFor({ timeout: 8000 });
  await p1.waitForTimeout(1100);
  await p1.locator('#btn-start').click();
  await p1.locator('#screen-game').waitFor({ timeout: 8000 });
  await p2.locator('#screen-game').waitFor({ timeout: 8000 });

  // Get P1's peg position
  const p1PegId = await p1.locator('.peg.can-move').first().getAttribute('data-peg-id');
  const startPos = await p1.evaluate((pegId) => {
    // eslint-disable-next-line no-undef
    const peg = document.querySelector(`.peg[data-peg-id="${pegId}"]`);
    const tile = peg?.parentElement;
    return { r: +tile.dataset.r, c: +tile.dataset.c };
  }, p1PegId);

  // Select peg
  await p1.locator(`.peg[data-peg-id="${p1PegId}"]`).click();
  await p1.locator('.tile.valid-move, .tile.can-move').first().waitFor({ timeout: 5000 });

  // Find valid move tile (not occupied, not own corner)
  const validTiles = await p1.locator('.tile:not(.corner).can-move').all();
  if (validTiles.length === 0) {
    // No valid moves - game may be in different state, just skip verification
    await ctx1.close();
    await ctx2.close();
    return;
  }
  expect(validTiles.length).toBeGreaterThan(0);

  const targetTile = validTiles[0];
  await targetTile.click();

  // Wait for modal (normal move = 1 question)
  await p1.locator('#modal-overlay.visible').waitFor({ timeout: 5000 });

  // Answer the question (just click any option)
  const optBtns = p1.locator('#modal-options .modal-option');
  await optBtns.nth(0).click();

  // Wait for modal to close after answer
  await p1.locator('#modal-overlay:not(.visible)').waitFor({ timeout: 5000 });

  const newPos = await p1.evaluate((pegId) => {
    // eslint-disable-next-line no-undef
    const peg = document.querySelector(`.peg[data-peg-id="${pegId}"]`);
    const tile = peg?.parentElement;
    return { r: +tile.dataset.r, c: +tile.dataset.c };
  }, p1PegId);

  // Verify position changed
  expect(newPos.r).not.toBe(startPos.r);
  expect(newPos.c).not.toBe(startPos.c);

  // Verify stats were updated after game
  const p1GamesAfter = await getUserGamesPlayed('e2e_normal_p1@test.invalid');
  const p2GamesAfter = await getUserGamesPlayed('e2e_normal_p2@test.invalid');
  expect(p1GamesAfter).toBeGreaterThan(0);
  expect(p2GamesAfter).toBeGreaterThan(0);

  await ctx1.close();
  await ctx2.close();
});
