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

function pegAt(page, pos, pegId) {
  return page.locator(`.tile[data-r="${pos.r}"][data-c="${pos.c}"] .peg[data-peg-id="${pegId}"]`);
}

async function firstValidTile(page) {
  const tile = page.locator('.tile.valid-move').first();
  await tile.waitFor({ timeout: 5000 });
  return {
    tile,
    pos: {
      r: Number(await tile.getAttribute('data-r')),
      c: Number(await tile.getAttribute('data-c')),
    },
  };
}

test('board: picks are colored for player and spectator, peg moves only on correct', async ({
  browser,
}) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});

  const { ctx1, p1, ctx2, p2 } = await startBoardGame(browser);
  const wrongIdx = TEST_QUESTION.correctIdx === 0 ? 1 : 0;
  const spectatorOption = (i) => p2.locator('#modal-options .modal-option').nth(i);
  await setNextQuestion(TEST_QUESTION.id, { sticky: true });

  const pegId = await p1.locator('.peg.can-move').first().getAttribute('data-peg-id');
  await p1.locator(`.peg[data-peg-id="${pegId}"]`).click();

  const first = await firstValidTile(p1);
  await first.tile.click();
  await expect(p1.locator('#modal-question')).toHaveText(TEST_QUESTION.q, { timeout: 5000 });
  await expect(p2.locator('#modal-question')).toHaveText(TEST_QUESTION.q, { timeout: 5000 });
  await expect(spectatorOption(TEST_QUESTION.correctIdx)).toBeDisabled();
  const correctBtn = await answerBoardQuestion(p1, TEST_QUESTION.correctIdx);
  await expect(correctBtn).toHaveClass(/answer-correct/, { timeout: 3000 });
  await expect(correctBtn).not.toHaveClass(/answer-wrong/);
  await expect(spectatorOption(TEST_QUESTION.correctIdx)).toHaveClass(/answer-correct/, {
    timeout: 3000,
  });
  await p1.locator('#modal-continue-btn:not([disabled])').click({ timeout: 5000 });
  await expect(pegAt(p1, first.pos, pegId)).toBeVisible({ timeout: 5000 });

  if ((await p1.locator('.tile.valid-move').count()) === 0) {
    await p1.locator(`.peg[data-peg-id="${pegId}"]`).click();
  }
  const second = await firstValidTile(p1);
  await second.tile.click();
  await expect(p2.locator('#modal-overlay')).toHaveClass(/visible/, { timeout: 5000 });
  await answerBoardQuestion(p1, wrongIdx);
  await expect(spectatorOption(wrongIdx)).toHaveClass(/answer-wrong/, { timeout: 3000 });
  await expect(spectatorOption(TEST_QUESTION.correctIdx)).not.toHaveClass(/answer-correct/);
  await p1.locator('#modal-continue-btn:not([disabled])').click({ timeout: 5000 });
  await expect(p1.locator('#modal-overlay')).not.toHaveClass(/visible/, { timeout: 5000 });
  await expect(pegAt(p1, first.pos, pegId)).toBeVisible();
  await expect(pegAt(p1, second.pos, pegId)).toHaveCount(0);

  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await api.dispose();
  await ctx1.close();
  await ctx2.close();
});
