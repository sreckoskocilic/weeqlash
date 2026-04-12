// @ts-check
import { test, expect, request } from '@playwright/test';

const BASE = 'http://localhost:3000';

async function registerAndLogin(browser, username) {
  const api = await request.newContext({ baseURL: BASE });
  await api.post('/auth/register', {
    data: { username, email: `${username}@test.invalid`, password: 'testpass123' },
  });
  await api.dispose();

  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.locator('#login-username').fill(username);
  await page.locator('#login-password').fill('testpass123');
  await page.locator('#btn-login').click();
  await page.locator('#user-bar').waitFor({ timeout: 5000 });
  return { ctx, page };
}

async function answerRandom(page) {
  const btns = page.locator('#modal-options .modal-option:not([disabled])');
  const count = await btns.count();
  if (count === 0) {return;}
  await btns.nth(Math.floor(Math.random() * count)).click();
}

test('combat: Q1/3 → Q2/3 → Q3/3 sequential flow, outcome matches answers', async ({ browser }) => {
  const { ctx: ctx1, page: p1 } = await registerAndLogin(browser, 'e2e_attacker');
  const { ctx: ctx2, page: p2 } = await registerAndLogin(browser, 'e2e_defender');

  // P1 creates 4×4 room
  await p1.locator('[data-val="4"]').click();
  await p1.locator('#btn-create').click();
  await p1.locator('#screen-lobby').waitFor({ timeout: 5000 });
  const code = await p1.locator('#lobby-code').innerText();
  expect(code).toMatch(/^[A-Z0-9]{5}$/);

  // P2 joins
  await p2.locator('#join-code').fill(code);
  await p2.locator('#btn-join').click();
  await p2.locator('#screen-lobby').waitFor({ timeout: 5000 });

  // Start game
  await p1.locator('#btn-start:not([disabled])').waitFor({ timeout: 8000 });
  await p1.waitForTimeout(1200);
  await p1.locator('#btn-start').click();
  await p1.locator('#screen-game').waitFor({ timeout: 8000 });
  await p2.locator('#screen-game').waitFor({ timeout: 8000 });

  // Fetch game state to find peg IDs and positions
  const api = await request.newContext({ baseURL: BASE });
  // Teleport P1's peg to be adjacent to P2's peg using the test endpoint.
  // On 4×4: P1 starts at (0,0), P2 at (3,3). Place P1 at (3,2) — adjacent to P2.
  // We get peg IDs from the p1 DOM.
  const p1PegId = await p1.locator('.peg.can-move').first().getAttribute('data-peg-id');
  expect(p1PegId).toBeTruthy();

  // Get P2 peg position from P1's DOM (enemy peg = no can-move, different peg ID)
  const p2PegInfo = await p1.evaluate((myPegId) => {
    // eslint-disable-next-line no-undef
    const pegs = document.querySelectorAll('.peg');
    for (const peg of pegs) {
      if (peg.dataset.pegId !== myPegId) {
        const tile = peg.parentElement;
        return { id: peg.dataset.pegId, row: +tile.dataset.r, col: +tile.dataset.c };
      }
    }
    return null;
  }, p1PegId);
  expect(p2PegInfo).toBeTruthy();

  // Place P1 adjacent to P2 (one row above P2)
  const targetRow = Math.max(0, p2PegInfo.row - 1);
  const teleportRes = await api.post('/test/teleport-peg', {
    data: { code, pegId: p1PegId, row: targetRow, col: p2PegInfo.col },
  });
  const teleportData = await teleportRes.json();
  expect(teleportData.ok).toBe(true);
  expect(teleportData.socketsInRoom, 'Expected 2 sockets in room').toBeGreaterThanOrEqual(2);
  await api.dispose();

  // Wait for state update to propagate to browsers
  await p1.waitForTimeout(2500);

  // Verify P1's peg moved in the DOM
  await p1.locator(`.peg[data-peg-id="${p1PegId}"]`).waitFor({ timeout: 3000 });

  // P1 selects their peg and immediately clicks P2's tile (combat).
  // Valid-move tiles can be cleared by a subsequent state:update, so click the combat tile
  // immediately within the action:select_peg callback window.
  await p1.locator(`.peg.can-move[data-peg-id="${p1PegId}"]`).waitFor({ timeout: 3000 });
  await p1.locator(`.peg[data-peg-id="${p1PegId}"]`).click();
  const combatTile = p1.locator(`[data-r="${p2PegInfo.row}"][data-c="${p2PegInfo.col}"]`);
  await combatTile.waitFor({ timeout: 3000 });
  await combatTile.click();

  // Combat modal should appear with Q1/3
  await p1.locator('#modal-overlay.visible').waitFor({ timeout: 5000 });
  const q1Label = await p1.locator('#modal-combat-label').innerText({ timeout: 2000 });
  expect(q1Label).toContain('COMBAT');
  expect(q1Label).toContain('Q1/3');

  // Answer all 3 questions, tracking correctness.
  // Each question: wait for label showing Qn/3, answer randomly, check result, wait for transition.
  const results = [];
  for (let q = 1; q <= 3; q++) {
    // Wait for the specific question label (Q1/3, Q2/3, Q3/3) — this handles the transition delay
    await p1.locator(`#modal-combat-label:has-text("Q${q}/3")`).waitFor({ timeout: 10000 });

    await answerRandom(p1);

    // Wait for answer feedback (correct/wrong highlight appears after ANSWER_DELAY_MS)
    const correct = await p1.locator('#modal-options .answer-correct').isVisible({ timeout: 4000 }).catch(() => false);
    results.push(correct);

    if (!correct) {
      // Wrong answer ends combat — modal closes
      await p1.locator('#modal-overlay:not(.visible)').waitFor({ timeout: 8000 });
      break;
    }
    if (q === 3) {
      // All 3 correct — modal closes
      await p1.locator('#modal-overlay:not(.visible)').waitFor({ timeout: 8000 });
    }
  }

  // Verify outcome
  await p1.waitForTimeout(600);
  const allCorrect = results.length === 3 && results.every(Boolean);
  const defPegs = await p2.locator('.peg').count();

  if (allCorrect) {
    expect(defPegs, 'Defender eliminated after 3 correct hits').toBe(0);
  } else {
    expect(defPegs, 'Defender survives if attacker missed').toBeGreaterThan(0);
  }

  await ctx1.close();
  await ctx2.close();
});
