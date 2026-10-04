import { chromium } from '@playwright/test';
import fs from 'fs';

const OG_VARIANT = process.argv[2] || 'logo';
const board = fs.readFileSync('scripts/brand/board.svg', 'utf8');
const index = fs.readFileSync('client/index.html', 'utf8');
const favicon = fs.readFileSync('client/favicon.svg', 'utf8');

const GAMES = [
  ['brawl', 'Brawl', '#00ff41'],
  ['qlashique', 'Qlashique', '#ffe600'],
  ['qlashword', 'Qlashword', '#5efbef'],
  ['howhigh', 'HowHigh?', '#e040fb'],
  ['skipnot', 'SkipNoT', '#ffb000'],
  ['mathquiz', 'MathQ', '#4fd1c5'],
  ['cento', 'CentoGrapher', '#34d399'],
];

function gameIcon(id) {
  const start = index.indexOf(`data-game="${id}"`);
  const svgStart = index.indexOf('<svg', start);
  return index.slice(svgStart, index.indexOf('</svg>', svgStart) + 6);
}

const mark = favicon
  .replace(/<rect width="32" height="32"[^>]*\/>/, '')
  .replace('<svg ', '<svg class="mark" ');

const FONTS =
  '<link href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@600;700&display=swap" rel="stylesheet">';

const BASE_CSS = `
  * { margin: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; overflow: hidden; position: relative;
    background: radial-gradient(ellipse at 50% 40%, #161625, #0e0e1a 75%); }
  .board { position: absolute; inset: 0; }
  .board svg { width: 100%; height: 100%; }
  .wash { position: absolute; inset: 0;
    background: radial-gradient(ellipse 260px 180px at 36% 40%, rgba(229,57,53,.07), transparent),
                radial-gradient(ellipse 260px 180px at 64% 52%, rgba(0,240,255,.06), transparent); }
  .logo { font: 700 170px/1 'Roboto Mono', monospace; color: #00ff41; letter-spacing: 6px;
    text-shadow: 0 0 28px rgba(0,255,65,.45); }
  .tag { font: 600 30px 'Roboto Mono', monospace; color: #ffb000; letter-spacing: 9px; text-transform: uppercase; }
  .mark { width: 84px; height: 84px; }
`;

const OG = {
  logo: `
    <div class="wash"></div>
    <div class="board" style="opacity:.5; transform: translateY(-40px) scale(1.15)">${board}</div>
    <div style="position:absolute; inset:0; background: radial-gradient(ellipse 460px 260px at 50% 56%, rgba(14,14,26,.92), rgba(14,14,26,.35) 70%, transparent)"></div>
    <div style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:18px; padding-top:30px">
      ${mark}
      <div class="logo">wQ$x</div>
      <div class="tag">trivia games · 1v1 &amp; solo</div>
    </div>`,
  games: `
    <div class="wash"></div>
    <div class="board" style="opacity:.28; transform: translate(-300px, 40px) scale(1.1)">${board}</div>
    <div style="position:absolute; left:80px; top:0; bottom:0; width:520px; display:flex; flex-direction:column; justify-content:center; gap:22px">
      ${mark}
      <div class="logo" style="font-size:150px">wQ$x</div>
      <div class="tag" style="font-size:26px; letter-spacing:7px">trivia games<br>1v1 &amp; solo · free</div>
    </div>
    <div style="position:absolute; right:70px; top:70px; bottom:70px; width:500px; display:grid; grid-template-columns:repeat(2,1fr); gap:14px; align-content:center">
      ${GAMES.map(
        ([
          id,
          name,
          c,
        ]) => `<div style="display:flex; align-items:center; gap:16px; padding:14px 18px; border:1px solid ${c}55; border-left:4px solid ${c}; border-radius:10px; background:#161625cc; color:${c}; font:700 26px 'Roboto Mono', monospace">
          <span style="width:38px; height:38px; display:flex; filter: drop-shadow(0 0 8px ${c}88)">${gameIcon(id).replace('<svg ', '<svg width="38" height="38" ')}</span>${name}</div>`,
      ).join('')}
    </div>`,
};

const ICON = (size) => `
  <body style="margin:0; width:${size}px; height:${size}px; background:#0e0e1a; display:grid; place-items:center">
    ${favicon
      .replace(/<rect width="32" height="32"[^>]*\/>/, '')
      .replace(
        '<svg ',
        `<svg width="${Math.round(size * 0.66)}" height="${Math.round(size * 0.66)}" `,
      )}
  </body>`;

const browser = await chromium.launch();
const page = await browser.newPage();

await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(
  `<!doctype html><html><head>${FONTS}<style>${BASE_CSS}</style></head><body>${OG[OG_VARIANT]}</body></html>`,
  { waitUntil: 'networkidle' },
);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: 'client/og-image.png' });

for (const [file, size] of [
  ['client/apple-touch-icon.png', 180],
  ['client/icon-192.png', 192],
  ['client/icon-512.png', 512],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><html>${ICON(size)}</html>`);
  await page.screenshot({ path: file });
}

await browser.close();
