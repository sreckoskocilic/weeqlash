// @ts-check
// Regression: attacker's own option must be highlighted green (answer-correct) when
// they click the correct answer. Previously the server stripped correctIdx from the
// question payload sent back to the attacker, so client comparison failed and the
// button was always marked answer-wrong (red) even though the server processed it
// as correct. Spectators were unaffected.

import { test, expect } from '@playwright/test';
import { registerAndLogin, setNextQuestion, TEST_QUESTION } from './e2e-helpers.js';

test('correct answer highlights attacker button green', async ({ browser }) => {
  const { ctx: ctx1, page: p1 } = await registerAndLogin(browser, 'e2e_normal_p1');
  const { ctx: ctx2, page: p2 } = await registerAndLogin(browser, 'e2e_normal_p2');

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

  // Lock the next question so we know which option index is correct.
  await setNextQuestion();

  const p1PegId = await p1.locator('.peg.can-move').first().getAttribute('data-peg-id');
  await p1.locator(`.peg[data-peg-id="${p1PegId}"]`).click();

  await p1.locator('.tile.valid-move').first().waitFor({ timeout: 3000 });
  const validTiles = await p1.locator('.tile.valid-move').all();
  expect(validTiles.length).toBeGreaterThan(0);
  await validTiles[0].click();

  await p1.locator('#modal-overlay.visible').waitFor({ timeout: 5000 });
  await expect(p1.locator('#modal-question')).toHaveText(TEST_QUESTION.q);

  // Server rejects answers before MIN_ANSWER_DELAY_MS (300ms).
  await p1.waitForTimeout(400);

  const correctBtn = p1.locator('#modal-options .modal-option').nth(TEST_QUESTION.correctIdx);
  await correctBtn.click();

  // The attacker's own chosen button must be marked correct, not wrong.
  await expect(correctBtn).toHaveClass(/answer-correct/, { timeout: 3000 });
  await expect(correctBtn).not.toHaveClass(/answer-wrong/);

  await ctx1.close();
  await ctx2.close();
});
