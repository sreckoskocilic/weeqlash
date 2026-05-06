// @ts-check
// Board e2e: wrong answer on normal move — peg stays in place, move is consumed.
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

test('board: wrong answer on normal move keeps peg in original tile', async ({ browser }) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });

  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  // Force a known question so we can deliberately answer wrong
  await setNextQuestion(TEST_QUESTION.id, { sticky: true });

  const { ctx: ctx1, page: p1 } = await registerAndLogin(browser, 'e2e_normal_p1');
  const { ctx: ctx2, page: p2 } = await registerAndLogin(browser, 'e2e_normal_p2');

  // Create 4×4 game
  await p1.locator('[data-view="settings"]').click();
  await p1.locator('[data-val="4"]').click();
  await p1.locator('[data-view="play"]').click();
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

  // Get P1's selectable peg
  const pegLocator = p1.locator('.peg.can-move').first();
  const pegId = await pegLocator.getAttribute('data-peg-id');

  // Record starting position
  const startPos = await p1.evaluate((pid) => {
    // eslint-disable-next-line no-undef
    const peg = document.querySelector(`.peg[data-peg-id="${pid}"]`);
    const tile = peg?.parentElement;
    return { r: +tile.dataset.r, c: +tile.dataset.c };
  }, pegId);

  // Select peg
  await pegLocator.click();
  await p1.waitForTimeout(500);

  // Click a valid move tile (normal, not combat)
  const moveTiles = p1.locator('.tile.valid-move');
  const moveCount = await moveTiles.count();
  expect(moveCount).toBeGreaterThan(0);

  const targetPos = await moveTiles.first().evaluate((el) => ({
    r: +el.dataset.r,
    c: +el.dataset.c,
  }));
  await moveTiles.first().click();

  // Wait for question modal
  await p1.locator('#modal-overlay.visible').waitFor({ timeout: 5000 });

  // Answer WRONG (TEST_QUESTION correctIdx=0, so pick option 1)
  const wrongBtn = p1.locator('#modal-options .modal-option').nth(1);
  await wrongBtn.click();

  // Wait for answer feedback + modal close
  await p1.waitForTimeout(1500);

  // Peg should still be at original position, NOT at target
  const afterPos = await p1.evaluate((pid) => {
    // eslint-disable-next-line no-undef
    const peg = document.querySelector(`.peg[data-peg-id="${pid}"]`);
    const tile = peg?.parentElement;
    return { r: +tile.dataset.r, c: +tile.dataset.c };
  }, pegId);

  expect(afterPos.r).toBe(startPos.r);
  expect(afterPos.c).toBe(startPos.c);
  // Confirm peg is NOT at the target
  expect(afterPos.r !== targetPos.r || afterPos.c !== targetPos.c).toBe(true);

  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await api.dispose();
  await ctx1.close();
  await ctx2.close();
});
