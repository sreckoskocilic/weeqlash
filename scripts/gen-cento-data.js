// Generates server/game/cento-data.json for CentoGrapher from the dumped Wikidata
// geo fixtures. NO per-country hand-listing: structural correct[] pools are
// derived from the dump (cities, rivers, mountains, islands, seas, nature
// features, languages, currencies, continent, numbers), keeping only NOTABLE
// items (top cities by population, longest rivers, highest mountains, …) so the
// union of all countries' items — which CentoGrapher reuses as the distractor
// pool — never contains obscure small-town entries.
//
// Source dump lives OUTSIDE this repo (srazique-fixtures). Only the compact
// derived JSON is committed. Re-run after the dump changes:
//   node scripts/gen-cento-data.js
//
// Cultural categories (person/club/food/sport/…) are NOT in the dump; they come
// from the hand/LLM-curated overlay in server/game/centographer-culture.ts and
// are merged at runtime, not here.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Wikidata geo dump dir. Override with CENTO_DUMP_DIR env or argv[2]; the default
// is the local srazique-fixtures checkout.
const DUMP_DIR =
  process.env.CENTO_DUMP_DIR ||
  process.argv[2] ||
  '/Users/skocho/apps/repos/srazique-fixtures/data/geo';
const SVG_DIR = path.join(__dirname, '../client/assets/countries');
const OUT = path.join(__dirname, '../server/game/cento-data.json');

// dump country name -> existing SVG slug, where slugify(name) doesn't match.
// Countries with no SVG at all are intentionally absent (can't show an outline).
const SLUG_ALIAS = {
  'Czech Republic': 'czechia',
  'United States': 'united-states-of-america',
  'Democratic Republic of the Congo': 'dem-rep-congo',
  'Republic of the Congo': 'congo',
  "People's Republic of China": 'china',
  'Kingdom of the Netherlands': 'netherlands',
  'North Macedonia': 'macedonia',
  'The Bahamas': 'bahamas',
  'The Gambia': 'gambia',
  'Bosnia and Herzegovina': 'bosnia-and-herz',
  'Antigua and Barbuda': 'antigua-and-barb',
  'Federated States of Micronesia': 'micronesia',
  'Marshall Islands': 'marshall-is',
  'Solomon Islands': 'solomon-is',
  'Saint Kitts and Nevis': 'st-kitts-and-nevis',
  'Vatican City': 'vatican',
  'South Sudan': 's-sudan',
  'Dominican Republic': 'dominican-rep',
  'Central African Republic': 'central-african-rep',
};

function slugify(n) {
  return n
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Per-category caps on how many correct items to keep per country. Generous —
// the runtime MAX_PER_CAT caps what actually shows in one question.
const CAP = {
  city: 12,
  river: 10,
  mountain: 8,
  island: 6,
  nature: 12,
  sea: 4,
  language: 4,
  currency: 3,
  // cultural / extra-geo (present only after fetching the deferred + on-country
  // types; the consumer below tolerates their absence)
  border: 10,
  region: 8,
  lake: 6,
  club: 6,
  company: 6,
  university: 5,
  person: 8,
};

function fmtInt(n) {
  return String(Math.round(n)); // bare digits, no separators
}

function pushNamed(out, cat, arr, cap, sortKey) {
  if (!Array.isArray(arr)) return;
  let items = arr.filter((x) => x && x.name);
  if (sortKey) items = items.slice().sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0));
  const seen = new Set();
  for (const x of items) {
    if (seen.has(x.name)) continue;
    seen.add(x.name);
    out.push({ label: x.name, cat });
    if (seen.size >= cap) break;
  }
}

function buildCorrect(c) {
  const out = [];

  pushNamed(out, 'city', c.cities, CAP.city, 'population');
  pushNamed(out, 'river', c.rivers, CAP.river, 'length_km');
  pushNamed(out, 'mountain', c.mountains, CAP.mountain, 'elev_m');
  // islands: archipelagos + individual islands (deferred fetch), largest first
  pushNamed(
    out,
    'island',
    [].concat(c.archipelagos || []).concat(c.islands || []),
    CAP.island,
    'area_km2',
  );
  pushNamed(out, 'lake', c.lakes, CAP.lake, 'area_km2');

  // cultural + region pools (present only after the deferred/on-country fetches).
  // people/clubs/companies already arrive notability-sorted (sitelinks DESC).
  pushNamed(out, 'region', c.regions, CAP.region);
  pushNamed(out, 'club', c.football_clubs, CAP.club, 'sitelinks');
  pushNamed(out, 'company', c.companies, CAP.company, 'sitelinks');
  pushNamed(out, 'university', c.universities, CAP.university, 'sitelinks');
  pushNamed(out, 'person', c.people, CAP.person, 'sitelinks');
  for (const b of (c.borders || []).slice(0, CAP.border)) {
    if (b && b.name) out.push({ label: `Borders ${b.name}`, cat: 'border' });
  }

  // nature = the long tail of physical features, largest-first where size exists
  const nature = []
    .concat((c.waterfalls || []).map((x) => ({ name: x.name, s: x.height_m || 0 })))
    .concat((c.canyons || []).map((x) => ({ name: x.name, s: 0 })))
    .concat((c.deserts || []).map((x) => ({ name: x.name, s: x.area_km2 || 0 })))
    .concat((c.glaciers || []).map((x) => ({ name: x.name, s: x.area_km2 || 0 })))
    .concat((c.plateaus || []).map((x) => ({ name: x.name, s: 0 })))
    .concat((c.peninsulas || []).map((x) => ({ name: x.name, s: x.area_km2 || 0 })))
    .concat((c.gulfs || []).map((x) => ({ name: x.name, s: x.area_km2 || 0 })))
    .concat((c.volcanoes || []).map((x) => ({ name: x.name, s: x.elev_m || 0 })))
    .concat((c.straits || []).map((x) => ({ name: x.name, s: 0 })));
  pushNamed(out, 'nature', nature, CAP.nature, 's');

  for (const s of (c.seas || []).slice(0, CAP.sea)) {
    if (s && s.name) out.push({ label: `Has a ${s.name} coastline`, cat: 'sea' });
  }
  for (const l of (c.languages || []).slice(0, CAP.language)) {
    out.push({ label: `${l} is spoken here`, cat: 'language' });
  }
  for (const cur of (c.currencies || []).slice(0, CAP.currency)) {
    out.push({ label: `Uses the ${cur}`, cat: 'currency' });
  }
  for (const cont of c.continents || []) {
    out.push({ label: `In ${cont}`, cat: 'fact' });
  }

  // numbers — BARE, no unit and no explanation after the figure
  if (c.area_km2) out.push({ label: fmtInt(c.area_km2), cat: 'number' });
  if (c.population) out.push({ label: fmtInt(c.population), cat: 'number' });
  if (c.highest_elev_m) out.push({ label: fmtInt(c.highest_elev_m), cat: 'number' });
  if (c.life_expectancy) out.push({ label: fmtInt(c.life_expectancy), cat: 'number' });
  if (c.inception && /^\d{4}/.test(c.inception)) {
    out.push({ label: c.inception.slice(0, 4), cat: 'number' });
  }

  return out;
}

function main() {
  const dump = JSON.parse(fs.readFileSync(path.join(DUMP_DIR, 'by-country.json'), 'utf8'));
  const svgs = new Set(
    fs
      .readdirSync(SVG_DIR)
      .filter((f) => f.endsWith('.svg'))
      .map((f) => f.slice(0, -4)),
  );

  const countries = [];
  let skipped = [];
  for (const c of Object.values(dump)) {
    const slug = SLUG_ALIAS[c.name] || slugify(c.name);
    if (!svgs.has(slug)) {
      skipped.push(c.name);
      continue;
    }
    const correct = buildCorrect(c);
    if (correct.length < 8) {
      skipped.push(`${c.name} (only ${correct.length} items)`);
      continue;
    }
    // neighbor slugs (from P47 borders) for distractor tiering — only those we
    // actually have as countries; empty until borders are fetched.
    const neighbors = (c.borders || [])
      .map((b) => b && b.name && (SLUG_ALIAS[b.name] || slugify(b.name)))
      .filter((s) => s && svgs.has(s));
    countries.push({
      slug,
      name: c.name,
      continent: (c.continents && c.continents[0]) || 'Unknown',
      langs: c.languages || [],
      neighbors,
      correct,
    });
  }

  countries.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(OUT, JSON.stringify({ version: 1, countries }, null, 0) + '\n');
  console.log(`wrote ${countries.length} countries -> ${path.relative(process.cwd(), OUT)}`);
  console.log(`skipped ${skipped.length}: ${skipped.join(', ')}`);
}

main();
