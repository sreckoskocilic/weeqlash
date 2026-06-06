// One-off generator: world-atlas countries TopoJSON → one outline SVG per
// country in client/assets/countries/<slug>.svg. Recognizable (not literal):
// equirectangular projection with a cos(lat) east-west correction, each country
// fit to its own 512×512 viewBox.
// The SVGs are committed, so the deps below are NOT kept in package.json. To
// regenerate: npm i -D world-atlas topojson-client && node scripts/gen-country-outlines.js
// (then npm uninstall world-atlas topojson-client).
import { feature } from 'topojson-client';
import fs from 'fs';
import path from 'path';

const SRC = 'node_modules/world-atlas/countries-50m.json';
const OUT = 'client/assets/countries';
const SIZE = 512;
const PAD = 24;
const STROKE = '#3a6b72';
const FILL = 'rgba(58,107,114,0.12)';

function slug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const topo = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const fc = feature(topo, topo.objects.countries);

fs.mkdirSync(OUT, { recursive: true });

let count = 0;
for (const feat of fc.features) {
  const name = feat.properties && feat.properties.name;
  if (!name) {
    continue;
  }
  // collect rings (lon/lat)
  const polys =
    feat.geometry.type === 'Polygon' ? [feat.geometry.coordinates] : feat.geometry.coordinates;
  const rings = [];
  for (const poly of polys) {
    for (const ring of poly) {
      rings.push(ring);
    }
  }
  if (!rings.length) {
    continue;
  }

  // mid latitude for east-west correction
  let latSum = 0;
  let n = 0;
  for (const ring of rings) {
    for (const [, lat] of ring) {
      latSum += lat;
      n++;
    }
  }
  const k = Math.cos((latSum / n) * (Math.PI / 180)) || 1;
  const project = ([lon, lat]) => [lon * k, -lat];

  // project + bbox
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const projRings = rings.map((ring) =>
    ring.map((c) => {
      const [x, y] = project(c);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      return [x, y];
    }),
  );

  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const s = Math.min((SIZE - 2 * PAD) / w, (SIZE - 2 * PAD) / h);
  const offX = (SIZE - w * s) / 2;
  const offY = (SIZE - h * s) / 2;
  const tx = (x) => (offX + (x - minX) * s).toFixed(1);
  const ty = (y) => (offY + (y - minY) * s).toFixed(1);

  const d = projRings
    .map((ring) => 'M' + ring.map((p) => `${tx(p[0])},${ty(p[1])}`).join('L') + 'Z')
    .join('');

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">` +
    `<path d="${d}" fill="${FILL}" stroke="${STROKE}" stroke-width="2" ` +
    `stroke-linejoin="round" stroke-linecap="round"/></svg>`;

  fs.writeFileSync(path.join(OUT, `${slug(name)}.svg`), svg);
  count++;
}

console.log(`[outlines] wrote ${count} SVGs to ${OUT}`);
