// @ts-check
import { test, expect } from '@playwright/test';
import { registerAndLogin, setNextQuestion, TEST_QUESTION } from './e2e-helpers.js';

test('normal move: select peg → click empty tile → peg moves', async ({ browser }) => {
  const { ctx: ctx1, page: p1 } = await registerAndLogin(browser, 'e2e_normal_p1', {
    query: 'testSpeed=8',
  });
  const { ctx: ctx2, page: p2 } = await registerAndLogin(browser, 'e2e_normal_p2', {
    query: 'testSpeed=8',
  });

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
  await p1.waitForTimeout(1100);
  await p1.locator('#btn-start').click();
  await p1.locator('#screen-game').waitFor({ timeout: 8000 });
  await p2.locator('#screen-game').waitFor({ timeout: 8000 });

  await setNextQuestion();

  const p1PegId = await p1.locator('.peg.can-move').first().getAttribute('data-peg-id');
  const startPos = await p1.evaluate((pegId) => {
    // eslint-disable-next-line no-undef
    const peg = document.querySelector(`.peg[data-peg-id="${pegId}"]`);
    const tile = peg?.parentElement;
    return { r: Number(tile.dataset.r), c: Number(tile.dataset.c) };
  }, p1PegId);

  await p1.locator(`.peg[data-peg-id="${p1PegId}"]`).click();
  await p1.locator('.tile.valid-move').first().waitFor({ timeout: 5000 });

  const validTiles = await p1.locator('.tile.valid-move').all();
  expect(validTiles.length).toBeGreaterThan(0);

  const targetTile = validTiles[0];
  const target = {
    r: Number(await targetTile.getAttribute('data-r')),
    c: Number(await targetTile.getAttribute('data-c')),
  };
  await targetTile.click();

  await p1.locator('#modal-overlay.visible').waitFor({ timeout: 5000 });
  await expect(p1.locator('#modal-question')).toHaveText(TEST_QUESTION.q);

  await p1.waitForTimeout(400);
  await p1.locator('#modal-options .modal-option').nth(TEST_QUESTION.correctIdx).click();
  await p1.locator('#modal-continue-btn:not([disabled])').click({ timeout: 5000 });
  await expect(p1.locator('#modal-overlay')).not.toHaveClass(/visible/, { timeout: 5000 });
  await p1
    .locator(`.tile[data-r="${target.r}"][data-c="${target.c}"] .peg[data-peg-id="${p1PegId}"]`)
    .waitFor({ timeout: 5000 });

  const newPos = await p1.evaluate((pegId) => {
    // eslint-disable-next-line no-undef
    const peg = document.querySelector(`.peg[data-peg-id="${pegId}"]`);
    const tile = peg?.parentElement;
    return { r: Number(tile.dataset.r), c: Number(tile.dataset.c) };
  }, p1PegId);

  expect(newPos).toEqual(target);
  expect(Number(newPos.r !== startPos.r) + Number(newPos.c !== startPos.c)).toBe(1);

  await ctx1.close();
  await ctx2.close();
});
