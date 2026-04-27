// @ts-check
// Manual viewport audit: screenshots board game + qlashique at iPhone 13 size,
// reports horizontal overflow and small tap targets. Run via:
//   ENABLE_TEST_ROUTES=1 DB_PATH=./server/data/e2e.db npx playwright test tests/iphone13-audit.spec.js
// Outputs to ./screenshots/iphone13/

import { test, devices, request as playwrightRequest } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:3000';
const OUT_DIR = path.join(process.cwd(), 'screenshots', 'iphone13');
fs.mkdirSync(OUT_DIR, { recursive: true });

const iphone13 = devices['iPhone 13'];

// Audit a page: dump horizontal overflow culprits and tap targets <44px.
async function audit(page, label) {
  const report = await page.evaluate(() => {
    /* eslint-disable no-undef */
    const vw = document.documentElement.clientWidth;
    const docScroll = document.documentElement.scrollWidth;
    const overflowingEls = [];
    const all = Array.from(document.querySelectorAll('body *'));
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) {
        continue;
      }
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') {
        continue;
      }
      if (r.right > vw + 1 || r.left < -1) {
        overflowingEls.push({
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          cls: el.className?.toString().slice(0, 60) || null,
          left: Math.round(r.left),
          right: Math.round(r.right),
          width: Math.round(r.width),
        });
      }
    }
    // Dedup: only report leaf overflows (skip if a parent already overflows similarly)
    const tapSelectors =
      'button, [role="button"], a, .tile, .peg, .modal-option, .qlas-opt, .nav-btn';
    const taps = Array.from(document.querySelectorAll(tapSelectors));
    const smallTaps = [];
    for (const el of taps) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) {
        continue;
      }
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') {
        continue;
      }
      if (r.width < 44 || r.height < 44) {
        smallTaps.push({
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          cls: el.className?.toString().slice(0, 60) || null,
          w: Math.round(r.width),
          h: Math.round(r.height),
          text: (el.textContent || '').trim().slice(0, 30),
        });
      }
    }
    return {
      vw,
      docScroll,
      hasHorizontalScroll: docScroll > vw,
      overflowCount: overflowingEls.length,
      overflowSample: overflowingEls.slice(0, 15),
      smallTapCount: smallTaps.length,
      smallTapSample: smallTaps.slice(0, 25),
    };
    /* eslint-enable no-undef */
  });
  console.log(`\n=== ${label} ===`);
  console.log(
    `viewport=${report.vw}px doc=${report.docScroll}px hScroll=${report.hasHorizontalScroll}`,
  );
  console.log(`overflow elements: ${report.overflowCount}`);
  for (const o of report.overflowSample) {
    console.log(
      `  <${o.tag}#${o.id || '-'}.${o.cls || '-'}> L=${o.left} R=${o.right} W=${o.width}`,
    );
  }
  console.log(`small tap targets (<44px): ${report.smallTapCount}`);
  for (const t of report.smallTapSample) {
    console.log(`  <${t.tag}#${t.id || '-'}.${t.cls || '-'}> ${t.w}x${t.h} "${t.text}"`);
  }
}

async function loginPlayer(browser, username) {
  const ctx = await browser.newContext({ ...iphone13, baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.locator('#login-username').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('#login-username').fill(username);
  await page.locator('#login-password').fill('testpass123');
  await page.locator('#btn-login').click();
  await page.locator('#user-bar').waitFor({ state: 'visible', timeout: 8000 });
  return { ctx, page };
}

test('iphone13: board game in progress', async ({ browser }) => {
  test.setTimeout(60000);
  const { ctx: ctx1, page: p1 } = await loginPlayer(browser, 'e2e_normal_p1');
  const { ctx: ctx2, page: p2 } = await loginPlayer(browser, 'e2e_normal_p2');

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
  await p1.waitForTimeout(800);

  // Screenshot the board mid-game
  await p1.screenshot({ path: path.join(OUT_DIR, 'board-p1-fresh.png'), fullPage: true });
  await audit(p1, 'BOARD GAME (P1, fresh game state, before any move)');

  // Select a peg → tile click → question modal opens
  const pegId = await p1.locator('.peg.can-move').first().getAttribute('data-peg-id');
  await p1.locator(`.peg[data-peg-id="${pegId}"]`).click();
  await p1.waitForTimeout(400);

  await p1.screenshot({ path: path.join(OUT_DIR, 'board-p1-peg-selected.png'), fullPage: true });
  await audit(p1, 'BOARD GAME (P1, peg selected, valid moves highlighted)');

  const validTiles = await p1.locator('.tile:not(.corner).can-move').all();
  if (validTiles.length > 0) {
    await validTiles[0].click();
    await p1.locator('#modal-overlay.visible').waitFor({ timeout: 5000 });
    await p1.waitForTimeout(400);
    await p1.screenshot({
      path: path.join(OUT_DIR, 'board-p1-question-modal.png'),
      fullPage: true,
    });
    await audit(p1, 'BOARD GAME (P1, question modal open)');
  }

  await ctx1.close();
  await ctx2.close();
});

test('iphone13: qlashique decision panel + question panel', async ({ browser }) => {
  test.setTimeout(60000);
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const sampleRes = await api.get('/test/questions-sample');
  const sample = await sampleRes.json();
  const { qId } = sample[0];

  const { ctx: ctx1, page: p1 } = await loginPlayer(browser, 'e2e_qlas_p1');
  const { ctx: ctx2, page: p2 } = await loginPlayer(browser, 'e2e_qlas_p2');

  await p1.locator('#btn-qlas-create').click();
  await p1.waitForFunction(
    // eslint-disable-next-line no-undef
    () => document.getElementById('qlas-code-val')?.textContent?.trim().length === 5,
    { timeout: 8000 },
  );
  const code = (await p1.locator('#qlas-code-val').textContent())?.trim();

  await api.post('/test/set-hp', { data: { hp: 10 } });
  await p2.locator('#qlas-join-code').fill(code);
  await p2.locator('#btn-qlas-start').click();

  await p1.locator('#qlas-decision-panel').waitFor({ state: 'visible', timeout: 10000 });
  await p1.waitForTimeout(400);
  await p1.screenshot({ path: path.join(OUT_DIR, 'qlas-p1-decision.png'), fullPage: true });
  await audit(p1, 'QLASHIQUE (P1, decision panel: ATTACK / REROLL / END)');

  await api.post('/test/set-question', { data: { qId } });
  await p1.locator('#btn-qlas-attack').click();
  await p1.locator('#qlas-qpanel').waitFor({ state: 'visible', timeout: 5000 });
  await p1.waitForTimeout(400);
  await p1.screenshot({ path: path.join(OUT_DIR, 'qlas-p1-question.png'), fullPage: true });
  await audit(p1, 'QLASHIQUE (P1, question panel with 4 options + timer)');

  // P2 view while P1 is answering (spectator state)
  await p2.screenshot({ path: path.join(OUT_DIR, 'qlas-p2-spectating.png'), fullPage: true });
  await audit(p2, 'QLASHIQUE (P2, spectating opponent answering)');

  await api.dispose();
  await ctx1.close();
  await ctx2.close();
});
