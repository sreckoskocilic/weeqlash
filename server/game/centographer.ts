// CentoGrapher: one mega-question is the whole quiz; player picks every item true for the shown country. #correct hidden, varies per run/cat. +5/-8, capped at MAX_SCORE, no floor. Structural pools from Wikidata (cento-data.json), culture overlay merged in, distractors auto-drawn from other countries.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CULTURE } from './centographer-culture.ts';

export const CHOICE_COUNT = 60;
export const TIMER_MS = 60000;
export const POINTS_CORRECT = 5;
export const POINTS_WRONG = -8;
export const MAX_SCORE = 100;
export const MAX_PER_CAT = 5;

export type Cat =
  | 'border'
  | 'sea'
  | 'city'
  | 'river'
  | 'region'
  | 'nature'
  | 'mountain'
  | 'lake'
  | 'island'
  | 'person'
  | 'leader'
  | 'club'
  | 'brand'
  | 'company'
  | 'food'
  | 'drink'
  | 'landmark'
  | 'fact'
  | 'history'
  | 'language'
  | 'currency'
  | 'university'
  | 'invention'
  | 'music'
  | 'film'
  | 'sport'
  | 'animal'
  | 'fiction'
  | 'myth'
  | 'number';

export interface Item {
  label: string;
  cat: Cat;
}

export interface Country {
  name: string;
  slug: string; // matches /assets/countries/<slug>.svg
  correct: Item[];
  continent: string;
  langs: string[];
  neighbors: string[]; // slugs of bordering countries (from P47); may be empty
}

export interface Choice {
  id: string;
  label: string;
  correct: boolean;
}

function g(cat: Cat, labels: string[]): Item[] {
  return labels.map((label) => ({ label, cat }));
}

// --- load generated structural data + merge cultural overlay ---

const __dirname = path.dirname(fileURLToPath(import.meta.url));
interface RawCountry {
  slug: string;
  name: string;
  continent: string;
  langs: string[];
  correct: Item[];
  neighbors?: string[];
}
function loadRaw(): { version: number; countries: RawCountry[] } {
  const file = path.join(__dirname, 'cento-data.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(
      `centographer: cannot load ${file} — run \`node scripts/gen-cento-data.js\` to build it. (${
        (e as Error).message
      })`,
    );
  }
}
const RAW = loadRaw();

function mergeCorrect(structural: Item[], cult: Item[]): Item[] {
  const seen = new Set<string>();
  const out: Item[] = [];
  for (const it of [...structural, ...cult]) {
    if (seen.has(it.label)) {
      continue;
    }
    seen.add(it.label);
    out.push(it);
  }
  return out;
}

export const COUNTRIES: Country[] = RAW.countries.map((c) => ({
  slug: c.slug,
  name: c.name,
  continent: c.continent,
  langs: c.langs,
  neighbors: c.neighbors || [],
  correct: mergeCorrect(c.correct, CULTURE[c.slug] || []),
}));

export const COUNTRIES_BY_SLUG: Record<string, Country> = Object.fromEntries(
  COUNTRIES.map((c) => [c.slug, c]),
);

// --- distractor indices (same-language / same-continent → plausible traps) ---

const byLang = new Map<string, Set<string>>();
const byContinent = new Map<string, string[]>();
const ITEMS_BY_SLUG = new Map<string, Item[]>();
for (const c of COUNTRIES) {
  ITEMS_BY_SLUG.set(c.slug, c.correct);
  for (const l of c.langs) {
    let s = byLang.get(l);
    if (!s) {
      byLang.set(l, (s = new Set()));
    }
    s.add(c.slug);
  }
  const arr = byContinent.get(c.continent);
  if (arr) {
    arr.push(c.slug);
  } else {
    byContinent.set(c.continent, [c.slug]);
  }
}

// Universally-false items; obvious give-aways, capped hard at ABSURD_MAX per grid.
const ABSURD_MAX = 2;
export const ABSURD: Item[] = [
  ...g('fiction', [
    'Mickey Mouse',
    'Superman',
    'Batman',
    'Spider-Man',
    'Pikachu',
    'Darth Vader',
    'Sherlock Holmes',
    'Super Mario',
    'Sonic the Hedgehog',
    'Godzilla',
  ]),
  ...g('myth', ['Zeus', 'Poseidon', 'Hercules', 'Thor', 'Anubis']),
];

// Distractors must be proper-noun traps; abstract/relational/numeric cats are correct-only, never distractors.
export const NO_DISTRACT = new Set<Cat>(['language', 'currency', 'fact', 'sea']);

function collectItems(slugs: Iterable<string>, own: Set<string>, seen: Set<string>): Item[] {
  const out: Item[] = [];
  for (const s of slugs) {
    for (const it of ITEMS_BY_SLUG.get(s) || []) {
      if (NO_DISTRACT.has(it.cat) || own.has(it.label) || seen.has(it.label)) {
        continue;
      }
      seen.add(it.label);
      out.push(it);
    }
  }
  return out;
}

// Plausible distractor pool, tiered by closeness (tier1: neighbors+same-language, tier2: same continent), tier-first so closest items are consumed first.
function distractorPoolFor(country: Country): Item[] {
  const own = new Set(country.correct.map((i) => i.label));
  const seen = new Set<string>();

  const tier1 = new Set<string>();
  for (const s of country.neighbors) {
    if (COUNTRIES_BY_SLUG[s]) {
      tier1.add(s);
    }
  }
  for (const l of country.langs) {
    for (const s of byLang.get(l) || []) {
      tier1.add(s);
    }
  }
  tier1.delete(country.slug);

  const tier2 = new Set<string>();
  for (const s of byContinent.get(country.continent) || []) {
    if (s !== country.slug && !tier1.has(s)) {
      tier2.add(s);
    }
  }

  const pool = [
    ...shuffle(collectItems(tier1, own, seen)),
    ...shuffle(collectItems(tier2, own, seen)),
  ];

  // Fallback for isolated countries: top up from everyone else.
  if (pool.length < CHOICE_COUNT * 2) {
    const rest = COUNTRIES.map((c) => c.slug).filter((s) => s !== country.slug);
    pool.push(...shuffle(collectItems(rest, own, seen)));
  }
  // Absurd items aren't in this pool; buildChoices adds a tiny capped quota separately.
  return pool;
}

// --- helpers ---

function randInt(lo: number, hi: number): number {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function groupByCat(items: Item[]): Map<Cat, Item[]> {
  const m = new Map<Cat, Item[]>();
  for (const it of shuffle(items)) {
    const arr = m.get(it.cat);
    if (arr) {
      arr.push(it);
    } else {
      m.set(it.cat, [it]);
    }
  }
  return m;
}

// Build one question's choice set: random 0..MAX_PER_CAT correct per cat, then fill to CHOICE_COUNT from the distractor pool.
export function buildChoices(country: Country): Choice[] {
  const correctByCat = groupByCat(country.correct);
  // Tier-ordered (closest distractors first) — do NOT re-shuffle the whole pool.
  const distract = distractorPoolFor(country);

  const picked: { label: string; correct: boolean }[] = [];
  const usedLabels = new Set<string>();
  const catCount = new Map<Cat, number>();

  // Hidden #correct target, spread across a random subset of cats (some contribute 0) so the count is never predictable.
  const nCorrectTarget = randInt(8, 28);
  for (const cat of shuffle([...correctByCat.keys()])) {
    const remaining = nCorrectTarget - picked.length;
    if (remaining <= 0) {
      break;
    }
    const pool = correctByCat.get(cat)!;
    const room = Math.min(MAX_PER_CAT, pool.length, remaining);
    const take = randInt(0, room);
    for (let i = 0; i < take; i++) {
      const it = pool.pop();
      if (!it || usedLabels.has(it.label)) {
        continue;
      }
      usedLabels.add(it.label);
      picked.push({ label: it.label, correct: true });
      catCount.set(cat, (catCount.get(cat) ?? 0) + 1);
    }
  }

  // Guarantee at least one correct answer.
  if (!picked.some((p) => p.correct)) {
    for (const cat of shuffle([...correctByCat.keys()])) {
      const it = correctByCat.get(cat)!.pop();
      if (it) {
        usedLabels.add(it.label);
        picked.push({ label: it.label, correct: true });
        catCount.set(cat, (catCount.get(cat) ?? 0) + 1);
        break;
      }
    }
  }

  // Reserve up to ABSURD_MAX absurd slots so the proper-noun fill below doesn't claim the whole grid first.
  const absurdQuota = randInt(0, ABSURD_MAX);
  const properTarget = CHOICE_COUNT - absurdQuota;

  // Distractors: real proper-noun traps, capped per category for variety.
  for (const it of distract) {
    if (picked.length >= properTarget) {
      break;
    }
    if (usedLabels.has(it.label) || (catCount.get(it.cat) ?? 0) >= MAX_PER_CAT) {
      continue;
    }
    usedLabels.add(it.label);
    picked.push({ label: it.label, correct: false });
    catCount.set(it.cat, (catCount.get(it.cat) ?? 0) + 1);
  }

  // The capped quota of absurd items.
  let absurdLeft = absurdQuota;
  for (const it of shuffle(ABSURD)) {
    if (picked.length >= CHOICE_COUNT || absurdLeft <= 0) {
      break;
    }
    if (usedLabels.has(it.label)) {
      continue;
    }
    usedLabels.add(it.label);
    picked.push({ label: it.label, correct: false });
    absurdLeft--;
  }

  // Top-up with more proper nouns (ignoring the per-cat cap) if still short.
  if (picked.length < CHOICE_COUNT) {
    for (const it of distract) {
      if (picked.length >= CHOICE_COUNT) {
        break;
      }
      if (usedLabels.has(it.label)) {
        continue;
      }
      usedLabels.add(it.label);
      picked.push({ label: it.label, correct: false });
    }
  }

  return shuffle(picked).map((c, i) => ({ id: 'c' + i, label: c.label, correct: c.correct }));
}

// Score selected ids against the choice set. Capped at MAX_SCORE; no lower floor.
export function scoreCento(
  choices: { id: string; correct: boolean }[],
  selectedIds: string[],
): { score: number; correctPicked: number; wrongPicked: number } {
  const sel = new Set(selectedIds);
  let raw = 0;
  let correctPicked = 0;
  let wrongPicked = 0;
  for (const c of choices) {
    if (sel.has(c.id)) {
      if (c.correct) {
        raw += POINTS_CORRECT;
        correctPicked++;
      } else {
        raw += POINTS_WRONG;
        wrongPicked++;
      }
    }
  }
  return { score: Math.min(raw, MAX_SCORE), correctPicked, wrongPicked };
}
