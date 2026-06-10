import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import './helpers/isolate-db.js';
import {
  initDb,
  getDb,
  insertScoreForMode,
  getTop10ForMode,
  checkQualifiesTop10ForMode,
  pruneMode,
} from '../server/game/leaderboard.ts';

const MODE = 'triviandom';
const OTHER = 'skipnot';

function rowCount(slug) {
  const db = getDb();
  const m = db.prepare('SELECT id FROM game_modes WHERE slug = ?').get(slug);
  return db.prepare('SELECT COUNT(*) AS c FROM leaderboard WHERE mode_id = ?').get(m.id).c;
}

function clearMode(slug) {
  const db = getDb();
  const m = db.prepare('SELECT id FROM game_modes WHERE slug = ?').get(slug);
  db.prepare('DELETE FROM leaderboard WHERE mode_id = ?').run(m.id);
}

beforeAll(() => {
  initDb();
});

beforeEach(() => {
  clearMode(MODE);
  clearMode(OTHER);
});

describe('leaderboard: insert + retrieve', () => {
  it('insertScoreForMode persists and getTop10ForMode returns it', () => {
    insertScoreForMode(MODE, 'Alice', 10, 5000);
    const top = getTop10ForMode(MODE);
    expect(top).toHaveLength(1);
    expect(top[0]).toMatchObject({ name: 'Alice', answers: 10, time_ms: 5000 });
  });

  it('orders by answers DESC, then time_ms ASC', () => {
    insertScoreForMode(MODE, 'P1', 5, 5000);
    insertScoreForMode(MODE, 'P2', 10, 3000);
    insertScoreForMode(MODE, 'P3', 10, 5000);
    expect(getTop10ForMode(MODE).map((r) => r.name)).toEqual(['P2', 'P3', 'P1']);
  });

  it('caps the returned board at 10', () => {
    for (let i = 0; i < 12; i++) {
      insertScoreForMode(MODE, `P${i}`, i, 1000);
    }
    expect(getTop10ForMode(MODE)).toHaveLength(10);
  });

  it('isolates entries across modes', () => {
    insertScoreForMode(MODE, 'TriviaP', 8, 4000);
    insertScoreForMode(OTHER, 'SkipP', 200, 60000);
    expect(getTop10ForMode(MODE).map((r) => r.name)).toEqual(['TriviaP']);
    expect(getTop10ForMode(OTHER).map((r) => r.name)).toEqual(['SkipP']);
  });
});

describe('leaderboard: input + mode guards', () => {
  it('rejects an over-long name (no row written)', () => {
    const out = insertScoreForMode(MODE, 'x'.repeat(17), 5, 1000);
    expect(out).toEqual([]);
    expect(rowCount(MODE)).toBe(0);
  });

  it('rejects non-numeric answers/time (no row written)', () => {
    expect(insertScoreForMode(MODE, 'Bad', '5', 1000)).toEqual([]);
    expect(insertScoreForMode(MODE, 'Bad', 5, '1000')).toEqual([]);
    expect(rowCount(MODE)).toBe(0);
  });

  it('unknown mode is inert', () => {
    expect(insertScoreForMode('no_such_mode', 'Ghost', 5, 1000)).toEqual([]);
    expect(getTop10ForMode('no_such_mode')).toEqual([]);
    expect(checkQualifiesTop10ForMode('no_such_mode', 999, 1)).toBe(false);
  });
});

describe('leaderboard: checkQualifiesTop10ForMode (cnt < 10 cap)', () => {
  it('qualifies while fewer than 10 strictly-better entries exist', () => {
    for (let i = 0; i < 9; i++) {
      insertScoreForMode(MODE, `Better${i}`, 100, 1000);
    }
    expect(checkQualifiesTop10ForMode(MODE, 50, 1000)).toBe(true);
  });

  it('does not qualify once 10 strictly-better entries exist', () => {
    for (let i = 0; i < 10; i++) {
      insertScoreForMode(MODE, `Better${i}`, 100, 1000);
    }
    expect(checkQualifiesTop10ForMode(MODE, 50, 1000)).toBe(false);
  });

  it('counts an equal-score-but-faster entry as better', () => {
    for (let i = 0; i < 9; i++) {
      insertScoreForMode(MODE, `Hi${i}`, 100, 1000);
    }
    insertScoreForMode(MODE, 'SameScoreFaster', 50, 500);
    expect(checkQualifiesTop10ForMode(MODE, 50, 1000)).toBe(false);
  });
});

describe('leaderboard: pruneMode', () => {
  it('keeps the top 100 and drops the rest', () => {
    for (let i = 0; i < 105; i++) {
      insertScoreForMode(MODE, `P${i}`, i, 1000);
    }
    pruneMode(MODE);
    expect(rowCount(MODE)).toBe(100);
    const top = getTop10ForMode(MODE);
    expect(top[0].answers).toBe(104);
  });
});
