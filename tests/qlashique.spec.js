// @ts-check
import { test, expect, request as playwrightRequest } from '@playwright/test';

const BASE = 'http://localhost:3000';

async function loginPlayer(browser, username) {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.waitForTimeout(500);
  await page.locator('#login-username').fill(username);
  await page.locator('#login-password').fill('testpass123');
  await page.locator('#btn-login').click();
  await page.waitForTimeout(1200);
  return { ctx, page };
}

// Play one turn: set the predefined question, click ATTACK, answer, stop, end turn.
// answerIdx is the option to click (pass correctIdx to win, a wrong idx to self-damage).
async function playTurn(page, api, qId, answerIdx) {
  // Force the known question so we control the outcome
  await api.post('/test/set-question', { data: { qId } });
  await page.locator('#btn-qlas-attack').click();
  await page.locator('#qlas-qpanel').waitFor({ state: 'visible', timeout: 8000 });
  await page.locator('.qlas-opt').nth(answerIdx).click();
  await page.waitForTimeout(300);
  // END ATTACK stops the timer; END TURN submits the score
  await page.locator('#btn-qlas-stop').click();
  await page.locator('#btn-qlas-end').waitFor({ state: 'visible', timeout: 5000 });
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
      await p1.waitForTimeout(400);
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

  await api.dispose();
  await ctx1.close();
  await ctx2.close();
});
