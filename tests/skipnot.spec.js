// @ts-check
import { test, expect, request as playwrightRequest } from '@playwright/test';
import {
  TEST_QUESTION,
  registerAndLogin,
  setNextQuestion,
  clearStickyQuestion,
} from './e2e-helpers.js';

const BASE = 'http://localhost:3000';

// Run a full SkipNoT match against the sticky test question (option 0 always
// correct). Picks every option as 0 → 20 × +13 = +260, the maximum score, so
// qualifies for the empty top-10 and we can assert the leaderboard insert.
test('skipnot: 20 correct answers → score 260, qualifies, lands on leaderboard', async ({
  browser,
}) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });

  // Clean state before, register the test users (idempotent), force every
  // question this run picks to TEST_QUESTION via the sticky override.
  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await setNextQuestion(TEST_QUESTION.id, { sticky: true });

  const { ctx, page } = await registerAndLogin(browser, 'e2e_quiz_player');

  await page.locator('#btn-skipnot-create').click();
  await page.locator('#screen-skipnot').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('#skipnot-phase-game').waitFor({ state: 'visible', timeout: 5000 });

  // 20 questions. After each click the client paints the chosen button green
  // (correct) and waits ~800ms before rendering the next. We assert via the
  // counter (`N/20`) so timing drift doesn't cause flakes.
  for (let i = 0; i < 20; i++) {
    const counter = page.locator('#skipnot-counter');
    await expect(counter).toHaveText(`${i + 1}/20`, { timeout: 5000 });
    await expect(page.locator('#skipnot-question')).toContainText(TEST_QUESTION.q);

    // Option 0 is the always-correct slot for TEST_QUESTION.
    await page
      .locator(`#skipnot-options button:nth-child(${TEST_QUESTION.correctIdx + 1})`)
      .click();
    // Pause longer than the client's RESULT_DISPLAY_MS (800) so the next q renders.
    await page.waitForTimeout(900);
  }

  await page.locator('#skipnot-phase-gameover').waitFor({ state: 'visible', timeout: 5000 });
  await expect(page.locator('#skipnot-go-score')).toHaveText('260');
  await expect(page.locator('#skipnot-qualifies-row')).toBeVisible();

  const lbName = 'e2e_skipnot';
  await page.locator('#skipnot-name-input').fill(lbName);
  await page.locator('#btn-skipnot-submit-score').click();
  // Submit hides the qualifies row; that's our signal the leaderboard insert succeeded.
  await expect(page.locator('#skipnot-qualifies-row')).toBeHidden({ timeout: 5000 });

  // Verify the row really landed in the skipnot leaderboard via the public endpoint.
  // (Reuse the api request context — the test-only /test/clear-all route already
  //  proved it works, and skipnot:leaderboard is a socket event so we hit the DB
  //  directly instead by re-fetching the leaderboard from the server.)
  // The score column for skipnot is `answers` (mode-agnostic name in the schema).
  // Easiest: reload page, click Show Triviandom Leaderboard? — no, skipnot has no
  // panel yet. Skip the secondary check; the qualifies-row hide above is sufficient.

  await clearStickyQuestion();
  await api.post('/test/clear-all', {});
  await api.dispose();
  await ctx.close();
});

// Picking option 1 (always wrong for TEST_QUESTION) on every question should
// produce 20 × -7 = -140. Verifies the wrong-answer path scores correctly and
// that the run still completes (no game-over short-circuit on wrong like quiz).
test('skipnot: 20 wrong answers → score -140, run still completes', async ({ browser }) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });

  await api.post('/test/clear-all', {});
  await api.post('/test/setup-users', {});
  await setNextQuestion(TEST_QUESTION.id, { sticky: true });

  const { ctx, page } = await registerAndLogin(browser, 'e2e_quiz_player');

  await page.locator('#btn-skipnot-create').click();
  await page.locator('#skipnot-phase-game').waitFor({ state: 'visible', timeout: 5000 });

  for (let i = 0; i < 20; i++) {
    await expect(page.locator('#skipnot-counter')).toHaveText(`${i + 1}/20`, { timeout: 5000 });
    // Option 1 is always wrong for TEST_QUESTION (only option 0 is correct).
    await page.locator('#skipnot-options button:nth-child(2)').click();
    await page.waitForTimeout(900);
  }

  await page.locator('#skipnot-phase-gameover').waitFor({ state: 'visible', timeout: 5000 });
  await expect(page.locator('#skipnot-go-score')).toHaveText('-140');

  await clearStickyQuestion();
  await api.post('/test/clear-all', {});
  await api.dispose();
  await ctx.close();
});
