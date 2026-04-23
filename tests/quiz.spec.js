// @ts-check
import { test, expect, request as playwrightRequest } from '@playwright/test';

const BASE = 'http://localhost:3000';

test('triviandom: answer Q1 correctly, answer until wrong, submit to leaderboard', async ({
  browser,
}) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });

  // Clear leaderboard so a score of 1 is guaranteed to qualify for top-10.
  await api.post('/test/clear-leaderboard', {});

  // Force Q1 to a known question so we can reliably click the correct answer
  const sampleRes = await api.get('/test/questions-sample');
  const sample = await sampleRes.json();
  expect(sample.length).toBeGreaterThan(0);
  const { qId, correctIdx } = sample[0];
  const wrongIdx = (correctIdx + 1) % 4;
  await api.post('/test/set-question', { data: { qId } });

  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.waitForTimeout(500);
  await page.locator('#login-username').fill('e2e_quiz_player');
  await page.locator('#login-password').fill('testpass123');
  await page.locator('#btn-login').click();
  await page.waitForTimeout(1200);

  // Start triviandom quiz
  await page.locator('#btn-quiz-start').click();
  await page.locator('#modal-overlay').waitFor({ state: 'visible', timeout: 8000 });

  // Answer Q1 with the known correct option
  await page.locator('.modal-option').nth(correctIdx).click();
  await page.locator('#modal-continue-btn').waitFor({ state: 'visible', timeout: 5000 });

  // After a correct answer the button reads "NEXT QUESTION"
  await expect(page.locator('#modal-continue-btn')).toHaveText('NEXT QUESTION');
  await page.locator('#modal-continue-btn').click();

  // Keep answering with wrongIdx until the quiz ends (button reads "SEE RESULTS").
  // Q2+ are random; wrongIdx matches the correct answer ~25% of the time, so
  // the loop usually terminates on Q2 and always terminates within a few rounds.
  for (let i = 0; i < 20; i++) {
    await page
      .locator('.modal-option:not([disabled])')
      .first()
      .waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('.modal-option:not([disabled])').nth(wrongIdx).click();
    await page.locator('#modal-continue-btn').waitFor({ state: 'visible', timeout: 5000 });
    const btnText = await page.locator('#modal-continue-btn').textContent();
    if (btnText?.includes('SEE RESULTS')) {
      break;
    }
    // Answered correctly by chance — move to the next question
    await page.locator('#modal-continue-btn').click();
  }

  // Game over: click SEE RESULTS to reveal score and leaderboard form
  await expect(page.locator('#modal-continue-btn')).toHaveText('SEE RESULTS');
  await page.locator('#modal-continue-btn').click();
  await page.waitForTimeout(500);

  // Score must be at least 1 (Q1 was correct)
  const scoreEl = page.locator('#lb-name-input');
  await scoreEl.waitFor({ state: 'visible', timeout: 5000 });

  // Submit score to leaderboard
  const lbName = 'e2e_quiz_player';
  await page.locator('#lb-name-input').fill(lbName);
  await page.locator('#lb-name-input + button').click();
  await page.waitForTimeout(1500);

  // Entry must appear in the leaderboard with streak ≥ 1
  const rowsText = await page.locator('#lb-rows').textContent();
  expect(rowsText).toContain(lbName);

  await api.post('/test/clear-all', {});
  await api.dispose();
  await ctx.close();
});
