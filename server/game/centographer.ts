// Pure CentoGrapher logic — no I/O. One mega-question IS the whole quiz: a
// country outline is shown and the player selects every answer related to that
// country from a grid. The number of correct answers is hidden and varies per
// run. Score: +5 per correct pick, -8 per wrong pick, capped at +100, NO lower
// floor (the total can go negative). 60s timer (client-run).
//
// DATA RULE: only `correct` items must be factually true. Distractors can be
// ANYTHING that is NOT true for the shown country.
// DIVERSITY RULE: every item is tagged with a category; a built choice set has
// at most MAX_PER_CAT items from any one category (combining correct +
// distractors), so the grid is varied, not (e.g.) 15 cities.

export const CHOICE_COUNT = 36;
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
  | 'person'
  | 'club'
  | 'brand'
  | 'food'
  | 'landmark'
  | 'fact'
  | 'sport'
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
}

export interface Choice {
  id: string;
  label: string;
  correct: boolean;
}

// tag a batch of labels with one category
function g(cat: Cat, labels: string[]): Item[] {
  return labels.map((label) => ({ label, cat }));
}

// Big pool of items that are NOT true for Germany. Anything goes as long as it's
// wrong (foreign proper nouns, mythology, fiction, sound-alike traps, false
// claims, wrong numbers). Tagged so the diversity cap applies here too.
const DISTRACTORS: Item[] = [
  ...g('city', [
    'Paris',
    'Madrid',
    'Rome',
    'Lisbon',
    'Barcelona',
    'Naples',
    'Lyon',
    'Marseille',
    'Warsaw',
    'Kraków',
    'Seville',
    'Valencia',
    'Porto',
    'Athens',
    'Dublin',
    'Oslo',
    'Stockholm',
    'Moscow',
    'Tokyo',
    'Kyoto',
    'Cairo',
    'Rio de Janeiro',
    'São Paulo',
    'Sydney',
    'Toronto',
    'Istanbul',
    'Lima',
    'Bangkok',
    // German-SOUNDING but NOT German (sound-alike traps)
    'Salzburg',
    'Zürich',
    'Vienna',
    'Strasbourg',
    'Bern',
    'Geneva',
    'Graz',
  ]),
  ...g('river', [
    'Seine',
    'Loire',
    'Tagus',
    'Ebro',
    'Tiber',
    'Po',
    'Thames',
    'Volga',
    'Nile',
    'Amazon',
    'Ganges',
    'Mississippi',
    'Yangtze',
  ]),
  ...g('region', [
    'Tuscany',
    'Catalonia',
    'Andalusia',
    'Provence',
    'Normandy',
    'Sicily',
    'Scotland',
    'Galicia',
    'Liechtenstein',
  ]),
  ...g('person', [
    'Napoleon',
    'Leonardo da Vinci',
    'Picasso',
    'Cervantes',
    'Dante',
    'Monet',
    'Galileo',
    'Churchill',
    'Isaac Newton',
    'Shakespeare',
    'Salvador Dalí',
    'Michelangelo',
    'Tolstoy',
    'Julius Caesar',
  ]),
  ...g('club', [
    'Real Madrid',
    'FC Barcelona',
    'Juventus',
    'AC Milan',
    'Paris Saint-Germain',
    'Liverpool',
    'Ajax',
    'Benfica',
    'Manchester United',
  ]),
  ...g('landmark', [
    'Eiffel Tower',
    'Colosseum',
    'Sagrada Família',
    'Big Ben',
    'Louvre',
    'Acropolis',
    'Leaning Tower of Pisa',
    'Statue of Liberty',
    'Taj Mahal',
    'Great Wall of China',
  ]),
  ...g('nature', [
    'Mount Everest',
    'Sahara Desert',
    'Mount Fuji',
    'Niagara Falls',
    'Grand Canyon',
    'Kilimanjaro',
  ]),
  ...g('brand', ['Ferrari', 'Toyota', 'Renault', 'Fiat', 'Peugeot', 'Nokia']),
  ...g('fiction', [
    'Mickey Mouse',
    'Superman',
    'Batman',
    'Spider-Man',
    'Pikachu',
    'Darth Vader',
    'Sherlock Holmes',
    'Super Mario',
    'Sonic',
    'Godzilla',
  ]),
  ...g('myth', ['Zeus', 'Poseidon', 'Hercules', 'Ramesses II']),
  ...g('fact', [
    'Landlocked',
    'Borders Brazil',
    'Borders China',
    'Borders Spain',
    'Borders Russia',
    'Located in Africa',
    'On the Pacific Ocean',
    'In South America',
    'An island nation',
    'French is the official language',
    'Birthplace of pizza',
    'Birthplace of the tango',
    'Home of the pharaohs',
  ]),
  ...g('sport', ['Won the Cricket World Cup', 'Won the Rugby World Cup', 'Has an NFL franchise']),
  ...g('number', [
    '505,990',
    '301,340',
    '9,834,000',
    '47 million',
    '60 million',
    '125 million',
    '20',
    '17',
    '9',
  ]),
];

export const COUNTRIES: Country[] = [
  {
    name: 'Germany',
    slug: 'germany',
    correct: [
      ...g('border', [
        'Borders France',
        'Borders Poland',
        'Borders Austria',
        'Borders Switzerland',
        'Borders the Czech Republic',
        'Borders the Netherlands',
        'Borders Belgium',
        'Borders Denmark',
        'Borders Luxembourg',
      ]),
      ...g('sea', ['Has a Baltic Sea coastline', 'Has a North Sea coastline']),
      ...g('city', [
        'Berlin',
        'Munich',
        'Hamburg',
        'Cologne',
        'Frankfurt',
        'Stuttgart',
        'Düsseldorf',
        'Dresden',
        'Leipzig',
        'Nuremberg',
        'Bremen',
        'Hannover',
        'Dortmund',
        'Essen',
      ]),
      ...g('river', ['Rhine', 'Elbe', 'Danube', 'Main', 'Moselle', 'Spree', 'Oder', 'Weser']),
      ...g('region', [
        'Bavaria',
        'Saxony',
        'Hesse',
        'Thuringia',
        'Brandenburg',
        'North Rhine-Westphalia',
        'Baden-Württemberg',
        'Lower Saxony',
      ]),
      ...g('nature', ['Zugspitze', 'Black Forest', 'Harz', 'Bavarian Alps', 'Lake Constance']),
      ...g('person', [
        'Goethe',
        'Beethoven',
        'Bach',
        'Einstein',
        'Nietzsche',
        'Kant',
        'Schiller',
        'Brahms',
        'Gutenberg',
        'Karl Marx',
        'Max Planck',
      ]),
      ...g('club', [
        'Bayern Munich',
        'Borussia Dortmund',
        'Schalke 04',
        'RB Leipzig',
        'Bayer Leverkusen',
      ]),
      ...g('brand', ['Volkswagen', 'BMW', 'Mercedes-Benz', 'Audi', 'Porsche', 'Adidas', 'Siemens']),
      ...g('food', ['Bratwurst', 'Pretzel', 'Sauerkraut', 'Currywurst']),
      ...g('landmark', [
        'Brandenburg Gate',
        'Reichstag',
        'Neuschwanstein',
        'Cologne Cathedral',
        'Berlin Wall',
      ]),
      ...g('fact', [
        'In Central Europe',
        'Uses the Euro',
        'Member of the EU',
        'Member of NATO',
        'German is the official language',
        'Birthplace of the printing press',
        'Home of the Brothers Grimm',
        'Oktoberfest',
        'Autobahn',
      ]),
      ...g('sport', [
        'Won the FIFA World Cup',
        'Hosted the FIFA World Cup',
        'Hosted the Summer Olympics',
        'Produced an NBA MVP',
        'Has a UEFA Champions League winner',
        'Has a Formula 1 World Champion',
        'Has won Eurovision',
      ]),
      ...g('number', ['357,022', '83 million', '16']),
    ],
  },
];

export const COUNTRIES_BY_SLUG: Record<string, Country> = Object.fromEntries(
  COUNTRIES.map((c) => [c.slug, c]),
);

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

// Round-robin draw up to `n` items from category buckets, respecting MAX_PER_CAT
// via the shared `catCount` map (so correct + distractors combined stay capped).
function drawCapped(pool: Map<Cat, Item[]>, n: number, catCount: Map<Cat, number>): Item[] {
  const out: Item[] = [];
  let progress = true;
  while (out.length < n && progress) {
    progress = false;
    for (const cat of shuffle([...pool.keys()])) {
      if (out.length >= n) {
        break;
      }
      if ((catCount.get(cat) ?? 0) >= MAX_PER_CAT) {
        continue;
      }
      const arr = pool.get(cat);
      if (!arr || !arr.length) {
        continue;
      }
      out.push(arr.pop()!);
      catCount.set(cat, (catCount.get(cat) ?? 0) + 1);
      progress = true;
    }
  }
  return out;
}

// Build one question's choice set: a hidden, variable number of correct answers
// + distractors to CHOICE_COUNT, with at most MAX_PER_CAT per category overall.
export function buildChoices(country: Country): Choice[] {
  const catCount = new Map<Cat, number>();

  const nCorrect = randInt(8, 24);
  const chosenCorrect = drawCapped(groupByCat(country.correct), nCorrect, catCount);

  const correctLabels = new Set(country.correct.map((i) => i.label));
  const distractPool = groupByCat(DISTRACTORS.filter((d) => !correctLabels.has(d.label)));
  let chosenDistract = drawCapped(distractPool, CHOICE_COUNT - chosenCorrect.length, catCount);

  // Fallback: if the per-cat cap left us short, top up from leftover distractors.
  const shortfall = CHOICE_COUNT - chosenCorrect.length - chosenDistract.length;
  if (shortfall > 0) {
    const leftover = shuffle([...distractPool.values()].flat());
    chosenDistract = chosenDistract.concat(leftover.slice(0, shortfall));
  }

  return shuffle([
    ...chosenCorrect.map((it) => ({ label: it.label, correct: true })),
    ...chosenDistract.map((it) => ({ label: it.label, correct: false })),
  ]).map((c, i) => ({ id: 'c' + i, label: c.label, correct: c.correct }));
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
