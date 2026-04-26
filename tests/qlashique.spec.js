// @ts-check
import { test, expect, request as playwrightRequest } from '@playwright/test';

const BASE = 'http://localhost:3000';

async function loginPlayer(browser, username) {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.locator('#login-username').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('#login-username').fill(username);
  await page.locator('#login-password').fill('testpass123');
  await page.locator('#btn-login').click();
  await page.locator('#user-bar').waitFor({ state: 'visible', timeout: 5000 });
  return { ctx, page };
}

// Play one turn: set the predefined question, click ATTACK, answer, stop, end turn.
// answerIdx is the option to click (pass correctIdx to win, a wrong idx to self-damage).
async function playTurn(page, api, qId, answerIdx) {
  // Force the known question so we control the outcome
  await api.post('/test/set-question', { data: { qId } });
  await page.locator('#btn-qlas-attack').click();
  await page.locator('#qlas-qpanel').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('.qlas-opt').nth(answerIdx).click();
  // END ATTACK stops the timer; END TURN submits the score.
  // btn-qlas-stop.click() auto-waits for actionability, so no manual sleep needed.
  await page.locator('#btn-qlas-stop').click();
  await page.locator('#btn-qlas-end').waitFor({ state: 'visible', timeout: 3000 });
  await page.locator('#btn-qlas-end').click();
}

test('qlashique: full game plays to a winner with 3 HP', async ({ browser }) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });

  // Get a known question: we'll use correctIdx for P0 (attack) and a wrong idx for P1 (self-damage).
  // Game plan: T1 P0 attacks → P1 hp 3→2, T2 P1 self-damages → P1 hp 2→1, T3 P0 attacks → P1 hp 1→0. P0 wins.
  const sampleRes = await api.get('/test/questions-sample');
  const sample = await sampleRes.json();
  expect(sample.length).toBeGreaterThan(0);
  const { qId, correctIdx } = sample[0];
  const wrongIdx = (correctIdx + 1) % 4;

  const { ctx: ctx1, page: p1 } = await loginPlayer(browser, 'e2e_qlas_p1');
  const { ctx: ctx2, page: p2 } = await loginPlayer(browser, 'e2e_qlas_p2');

  // P1 creates qlashique room
  await p1.locator('#btn-qlas-start').click();
  await p1.waitForFunction(
    // eslint-disable-next-line no-undef
    () => document.getElementById('qlas-code-val')?.textContent?.trim().length === 5,
    { timeout: 8000 },
  );
  const code = await p1.locator('#qlas-code-val').textContent();

  // Set HP=3 before P2 joins — the override is consumed when the room auto-starts on join
  await api.post('/test/set-hp', { data: { hp: 3 } });

  // P2 joins — game auto-starts (HP=3), server emits qlashique:turn_start
  await p2.locator('#qlas-join-code').fill(code.trim());
  await p2.locator('#btn-qlas-start').click();

  // Wait for P1's decision panel (P0 goes first)
  await p1.locator('#qlas-decision-panel').waitFor({ state: 'visible', timeout: 10000 });

  // Play turns: P0 answers correctly (attack), P1 answers wrong (self-damage).
  // With 3 HP the game resolves in at most 3 turns.
  const MAX_TURNS = 10;
  for (let i = 0; i < MAX_TURNS; i++) {
    const gameOver = await p1.locator('#qlas-phase-gameover').isVisible();
    if (gameOver) {
      break;
    }

    const p1Turn = await p1.locator('#qlas-decision-panel').isVisible();
    const p2Turn = await p2.locator('#qlas-decision-panel').isVisible();

    if (p1Turn) {
      await playTurn(p1, api, qId, correctIdx); // P0: correct → attack
    } else if (p2Turn) {
      await playTurn(p2, api, qId, wrongIdx); // P1: wrong → self-damage
    } else {
      // Brief poll fallback: neither decision panel is visible yet (server turn transition in flight)
      await p1.waitForTimeout(150);
      continue;
    }

    // Wait for next decision panel or game over before looping
    await Promise.race([
      p1.locator('#qlas-phase-gameover').waitFor({ state: 'visible', timeout: 12000 }),
      p1.locator('#qlas-decision-panel').waitFor({ state: 'visible', timeout: 12000 }),
      p2.locator('#qlas-decision-panel').waitFor({ state: 'visible', timeout: 12000 }),
    ]).catch(() => {});
  }

  // Both screens must show the game over panel with a winner
  await expect(p1.locator('#qlas-phase-gameover')).toBeVisible({ timeout: 5000 });
  await expect(p2.locator('#qlas-phase-gameover')).toBeVisible({ timeout: 5000 });

  // Winner sees "YOU WIN!", loser sees "{name} WINS" — both must contain "WIN"
  const winner1 = (await p1.locator('#qlas-winner-text').textContent())?.trim();
  const winner2 = (await p2.locator('#qlas-winner-text').textContent())?.trim();
  expect(winner1).toMatch(/WIN/i);
  expect(winner2).toMatch(/WIN/i);

  // Verify game stats were recorded after game ends with a winner
  const p1Stats = await api.get('/test/user-stats/e2e_qlas_p1@test.invalid');
  const p2Stats = await api.get('/test/user-stats/e2e_qlas_p2@test.invalid');
  const p1Data = await p1Stats.json();
  const p2Data = await p2Stats.json();

  // Both players should have games_played = 1, winner should have games_won = 1
  expect(p1Data.games_played).toBe(1);
  expect(p2Data.games_played).toBe(1);

  // P0 is winner (they attack and win)
  expect(p1Data.games_won).toBe(1);
  expect(p2Data.games_won).toBe(0);

  // Verify game_history entry was created
  const p1History = await api.get('/test/game-history/e2e_qlas_p1@test.invalid');
  const p1HistoryData = await p1History.json();
  expect(p1HistoryData.gamesPlayed).toBe(1);

  await api.dispose();
  await ctx1.close();
  await ctx2.close();
});

test('qlashique: live recap populates after a few turns', async ({ browser }) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });

  const sampleRes = await api.get('/test/questions-sample');
  const sample = await sampleRes.json();
  expect(sample.length).toBeGreaterThan(0);
  const { qId, correctIdx } = sample[0];
  const wrongIdx = (correctIdx + 1) % 4;

  const { ctx: ctx1, page: p1 } = await loginPlayer(browser, 'e2e_qlas_p1');
  const { ctx: ctx2, page: p2 } = await loginPlayer(browser, 'e2e_qlas_p2');

  await p1.locator('#btn-qlas-start').click();
  await p1.waitForFunction(
    // eslint-disable-next-line no-undef
    () => document.getElementById('qlas-code-val')?.textContent?.trim().length === 5,
    { timeout: 8000 },
  );
  const code = await p1.locator('#qlas-code-val').textContent();

  // Use HP=20 so two turns won't end the game — we need the match alive to open recap.
  await api.post('/test/set-hp', { data: { hp: 20 } });

  await p2.locator('#qlas-join-code').fill(code.trim());
  await p2.locator('#btn-qlas-start').click();

  await p1.locator('#qlas-decision-panel').waitFor({ state: 'visible', timeout: 10000 });

  // Play 2 turns (P0 correct → attack, P1 wrong → self-damage). Neither kills at HP=20.
  for (let i = 0; i < 2; i++) {
    const p1Turn = await p1.locator('#qlas-decision-panel').isVisible();
    if (p1Turn) {
      await playTurn(p1, api, qId, correctIdx);
    } else {
      await playTurn(p2, api, qId, wrongIdx);
    }
    await Promise.race([
      p1.locator('#qlas-decision-panel').waitFor({ state: 'visible', timeout: 12000 }),
      p2.locator('#qlas-decision-panel').waitFor({ state: 'visible', timeout: 12000 }),
    ]).catch(() => {});
  }

  // Open the live recap on whichever page is now on its decision panel
  const active = (await p1.locator('#qlas-decision-panel').isVisible()) ? p1 : p2;
  await active.locator('#qlas-recap-live-btn').click();
  await active.locator('#qlas-recap-modal.show').waitFor({ state: 'visible', timeout: 5000 });

  // Recap must NOT be the empty placeholder
  await expect(active.locator('#qlas-recap-live .qlas-recap-empty')).toHaveCount(0);

  // Two turns played → two cards: T1 (P0 correct attack) and T2 (P1 wrong self-damage)
  const cards = active.locator('#qlas-recap-live .qlas-recap-card');
  await expect(cards).toHaveCount(2);

  // First card: P0 attack, correct (no .wrong), header shows T1 and positive score
  const t1 = cards.nth(0);
  await expect(t1).toHaveClass(/\bp0\b/);
  await expect(t1).not.toHaveClass(/\bwrong\b/);
  await expect(t1.locator('.qlas-recap-turn')).toHaveText('T1');
  await expect(t1.locator('.qlas-recap-entry')).toHaveCount(1);
  await expect(t1.locator('.qlas-recap-entry .ok')).toHaveCount(1);
  await expect(t1.locator('.qlas-recap-entry .bad')).toHaveCount(0);
  expect((await t1.locator('.qlas-recap-score').textContent())?.trim()).toMatch(/^\+/);

  // Second card: P1 self-damage, wrong (.wrong class), header shows T2 and negative score
  const t2 = cards.nth(1);
  await expect(t2).toHaveClass(/\bp1\b/);
  await expect(t2).toHaveClass(/\bwrong\b/);
  await expect(t2.locator('.qlas-recap-turn')).toHaveText('T2');
  await expect(t2.locator('.qlas-recap-entry')).toHaveCount(1);
  await expect(t2.locator('.qlas-recap-entry .bad')).toHaveCount(1);
  expect((await t2.locator('.qlas-recap-score').textContent())?.trim()).toMatch(/^-/);

  await api.dispose();
  await ctx1.close();
  await ctx2.close();
});

// Regression: the other two specs force a known question every turn via
// /test/set-question, which short-circuits `_pickQlasQuestion` before its
// real-pool branch ever runs. This spec engages WITHOUT an override so the
// server is forced to pull from the actual question pool — if the pool is
// empty (e.g. a category-filter regression like CATS_SET vs missing
// `q.category`), `start_guessing` errors out and `.qlas-opt` never appears.
test('qlashique: real pool serves a question (no override)', async ({ browser }) => {
  const { ctx: ctx1, page: p1 } = await loginPlayer(browser, 'e2e_qlas_p1');
  const { ctx: ctx2, page: p2 } = await loginPlayer(browser, 'e2e_qlas_p2');

  await p1.locator('#btn-qlas-start').click();
  await p1.waitForFunction(
    // eslint-disable-next-line no-undef
    () => document.getElementById('qlas-code-val')?.textContent?.trim().length === 5,
    { timeout: 8000 },
  );
  const code = await p1.locator('#qlas-code-val').textContent();

  await p2.locator('#qlas-join-code').fill(code.trim());
  await p2.locator('#btn-qlas-start').click();

  await p1.locator('#qlas-decision-panel').waitFor({ state: 'visible', timeout: 10000 });
  await p1.locator('#btn-qlas-attack').click();

  // 4 answer buttons appear → pool produced a question
  await expect(p1.locator('.qlas-opt')).toHaveCount(4, { timeout: 5000 });
  await expect(p1.locator('#qlas-question').locator('.qlas-q-text')).toBeVisible();

  await ctx1.close();
  await ctx2.close();
});
