import type Database from 'better-sqlite3';

// Append-only schema migrations.
//
// Rules:
//   - NEVER edit or reorder a migration that has shipped. Each migration runs at
//     most once per DB (tracked in `schema_migrations`).
//   - To make a new schema change, append a new entry with a fresh id.
//   - Migrations run inside a transaction; throw to roll back.
//   - Schema *creation* still lives in `leaderboard.ts initDb()` and
//     `auth.ts initAuthDb()` — migrations cover edits/drops that those
//     idempotent creators can't express.
interface Migration {
  id: string;
  up: (db: Database.Database) => void;
}

const MIGRATIONS: Migration[] = [
  {
    id: '001_drop_leaderboard_epl2025',
    up: (db) => {
      db.exec('DROP TABLE IF EXISTS leaderboard_epl2025');
    },
  },
];

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const applied = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as { id: string }[]).map((r) => r.id),
  );

  const insert = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');

  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    const tx = db.transaction(() => {
      m.up(db);
      insert.run(m.id, Date.now());
    });
    tx();
    console.log(`[migrate] applied ${m.id}`);
  }
}
