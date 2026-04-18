import { chromium } from "playwright";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const previewFile = resolve(__dirname, "../client/qlashique-preview.html");
const outDir = resolve(__dirname, "../design-variants");

const variants = [
  { id: 0, name: "neon-arcade" },
  { id: 1, name: "terminal" },
  { id: 2, name: "slate" },
  { id: 3, name: "synthwave" },
];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 900, height: 600 });

import { mkdirSync } from "fs";
mkdirSync(outDir, { recursive: true });

for (const v of variants) {
  await page.goto(`file://${previewFile}?v=${v.id}`);
  await page.waitForTimeout(300);
  const path = `${outDir}/${v.id}-${v.name}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(`saved: ${path}`);
}

await browser.close();
