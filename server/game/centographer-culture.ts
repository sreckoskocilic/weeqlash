// Hand/LLM-curated CULTURAL overlay for CentoGrapher, keyed by country slug.
//
// The structural pools (cities, rivers, mountains, languages, …) come from the
// Wikidata dump via scripts/gen-cento-data.js -> cento-data.json. The dump has
// NO cultural data and NO borders, so the "devious" categories live here:
// border, person, leader, club, brand, company, food, drink, landmark, history,
// invention, music, film, sport, plus extra cultural facts/numbers.
//
// This is the ONLY hand-written per-country data, and it is OPT-IN: a country
// with no entry here is still fully playable from its structural pool alone.
// Add craziness one country at a time. Every item here must be factually TRUE
// for that country (it is merged into `correct`); false/foreign items belong in
// the distractor pool, which is built automatically from other countries.
//
// DATA RULE (see project_centographer memory): make correct pools devious but
// true — lateral sport/culture facts ("Produced an NBA MVP"), not just the
// obvious. Distractors are generated; do not list them here.

import type { Cat, Item } from './centographer.ts';

function g(cat: Cat, labels: string[]): Item[] {
  return labels.map((label) => ({ label, cat }));
}

export const CULTURE: Record<string, Item[]> = {
  germany: [
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
    ...g('leader', [
      'Angela Merkel',
      'Otto von Bismarck',
      'Konrad Adenauer',
      'Willy Brandt',
      'Helmut Kohl',
    ]),
    ...g('club', [
      'Bayern Munich',
      'Borussia Dortmund',
      'Schalke 04',
      'RB Leipzig',
      'Bayer Leverkusen',
    ]),
    ...g('brand', ['Volkswagen', 'BMW', 'Mercedes-Benz', 'Audi', 'Porsche', 'Adidas', 'Puma']),
    ...g('company', ['SAP', 'Siemens', 'Bosch', 'Allianz', 'Lufthansa', 'BASF', 'Bayer']),
    ...g('food', [
      'Bratwurst',
      'Pretzel',
      'Sauerkraut',
      'Currywurst',
      'Black Forest cake',
      'Stollen',
    ]),
    ...g('drink', ['Riesling', 'Jägermeister', "Beck's", 'Weissbier', 'Apfelschorle']),
    ...g('landmark', [
      'Brandenburg Gate',
      'Reichstag',
      'Neuschwanstein',
      'Cologne Cathedral',
      'Berlin Wall',
    ]),
    ...g('history', [
      'Part of the Holy Roman Empire',
      'Reunified in 1990',
      'The Weimar Republic',
      'The Protestant Reformation began here',
    ]),
    ...g('invention', [
      'Invented the automobile',
      'Invented aspirin',
      'Co-invented the MP3 format',
      'Discovered X-rays',
      'Birthplace of the printing press',
    ]),
    ...g('music', ['Kraftwerk', 'Rammstein', 'Scorpions', 'Nena', 'Tokio Hotel']),
    ...g('film', ['Berlinale', 'Das Boot', 'Run Lola Run', 'Metropolis']),
    ...g('sport', [
      'Won the FIFA World Cup',
      'Hosted the Summer Olympics',
      'Produced an NBA MVP',
      'Has a UEFA Champions League winner',
      'Has a Formula 1 World Champion',
      'Has won Eurovision',
    ]),
    ...g('fact', [
      'Member of the EU',
      'Member of NATO',
      'Home of the Brothers Grimm',
      'Oktoberfest',
      'Autobahn',
    ]),
    ...g('number', ['16']),
  ],
};
