import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_DIR =
  process.env.POKEDOME_CSV_DIR || process.argv[2] || path.join(os.tmpdir(), 'pokeapi-csv');
const RAW = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv';
const OUT = path.join(__dirname, '../server/game/pokedex.json');

const EN_LANG = 9;
const MAX_TYPE_ID = 18;
const STAT_KEY = { 1: 'hp', 2: 'atk', 3: 'def', 4: 'spa', 5: 'spd', 6: 'spe' };
const FILES = [
  'pokemon_species',
  'pokemon',
  'pokemon_types',
  'pokemon_stats',
  'types',
  'type_efficacy',
  'abilities',
  'ability_names',
  'pokemon_abilities',
  'egg_group_prose',
  'pokemon_egg_groups',
  'pokemon_species_names',
  'pokemon_color_names',
];

async function loadCsv(name) {
  const file = path.join(CSV_DIR, `${name}.csv`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(CSV_DIR, { recursive: true });
    const res = await fetch(`${RAW}/${name}.csv`);
    if (!res.ok) throw new Error(`${name}.csv: HTTP ${res.status}`);
    fs.writeFileSync(file, await res.text());
    console.log(`fetched ${name}.csv`);
  }
  const [head, ...lines] = fs.readFileSync(file, 'utf8').trim().split('\n');
  const cols = head.split(',');
  return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
}

const csv = Object.fromEntries(await Promise.all(FILES.map(async (f) => [f, await loadCsv(f)])));

const num = (v) => (v === '' ? null : Number(v));
const bool = (v) => v === '1';
const isEnglish = (r) => Number(r.local_language_id) === EN_LANG;
const groupBy = (rows, key) => {
  const m = new Map();
  for (const r of rows) {
    const k = r[key];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
};

const types = csv.types.filter((t) => Number(t.id) <= MAX_TYPE_ID).map((t) => t.identifier);
const typeById = Object.fromEntries(csv.types.map((t) => [t.id, t.identifier]));
const chart = Object.fromEntries(types.map((t) => [t, {}]));
for (const e of csv.type_efficacy) {
  const att = typeById[e.damage_type_id];
  const def = typeById[e.target_type_id];
  if (chart[att] && types.includes(def)) chart[att][def] = Number(e.damage_factor) / 100;
}

const speciesName = new Map(
  csv.pokemon_species_names
    .filter(isEnglish)
    .map((r) => [r.pokemon_species_id, { name: r.name, genus: r.genus }]),
);
const colorName = Object.fromEntries(
  csv.pokemon_color_names.filter(isEnglish).map((r) => [r.pokemon_color_id, r.name]),
);
const eggName = Object.fromEntries(
  csv.egg_group_prose.filter(isEnglish).map((r) => [r.egg_group_id, r.name]),
);
const mainAbility = new Set(csv.abilities.filter((a) => bool(a.is_main_series)).map((a) => a.id));
const abilityName = Object.fromEntries(
  csv.ability_names
    .filter((r) => isEnglish(r) && mainAbility.has(r.ability_id))
    .map((r) => [r.ability_id, r.name]),
);

const defaultForm = new Map(
  csv.pokemon.filter((p) => bool(p.is_default)).map((p) => [p.species_id, p]),
);
const typesOf = groupBy(csv.pokemon_types, 'pokemon_id');
const statsOf = groupBy(csv.pokemon_stats, 'pokemon_id');
const abilitiesOf = groupBy(csv.pokemon_abilities, 'pokemon_id');
const eggsOf = groupBy(csv.pokemon_egg_groups, 'species_id');
const bySlot = (a, b) => Number(a.slot) - Number(b.slot);

const species = [];
const noHangman = [];
for (const s of csv.pokemon_species) {
  const form = defaultForm.get(s.id);
  const { name, genus } = speciesName.get(s.id);
  if (!form) throw new Error(`${name}: no default form`);
  const hangman = /^[A-Za-z]+$/.test(name) ? name.toUpperCase() : null;
  if (!hangman) noHangman.push(name);

  species.push({
    id: Number(s.id),
    name,
    hangman,
    genus,
    gen: Number(s.generation_id),
    types: (typesOf.get(form.id) ?? []).sort(bySlot).map((t) => typeById[t.type_id]),
    stats: Object.fromEntries(
      (statsOf.get(form.id) ?? []).map((r) => [STAT_KEY[r.stat_id], Number(r.base_stat)]),
    ),
    abilities: (abilitiesOf.get(form.id) ?? [])
      .filter((a) => abilityName[a.ability_id])
      .sort(bySlot)
      .map((a) => ({ name: abilityName[a.ability_id], hidden: bool(a.is_hidden) })),
    eggGroups: (eggsOf.get(s.id) ?? []).map((e) => eggName[e.egg_group_id]),
    color: colorName[s.color_id],
    heightDm: Number(form.height),
    weightHg: Number(form.weight),
    baseExp: num(form.base_experience),
    captureRate: Number(s.capture_rate),
    genderRate: Number(s.gender_rate),
    evolvesFrom: num(s.evolves_from_species_id),
    chain: Number(s.evolution_chain_id),
    legendary: bool(s.is_legendary),
    mythical: bool(s.is_mythical),
    baby: bool(s.is_baby),
  });
}
species.sort((a, b) => a.id - b.id);

fs.writeFileSync(OUT, JSON.stringify({ version: 1, types, chart, species }, null, 2) + '\n');
console.log(`wrote ${OUT}: ${species.length} species, ${types.length} types`);
console.log(`no hangman (${noHangman.length}): ${noHangman.join(', ')}`);
