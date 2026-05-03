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
  {
    id: '002_normalize_leaderboard_with_game_modes',
    up: (db) => {
      // Idempotency: skip on fresh DBs where leaderboard was already created
      // with mode_id by initDb() (see leaderboard.ts).
      const cols = db.prepare('PRAGMA table_info(leaderboard)').all() as { name: string }[];
      if (cols.some((c) => c.name === 'mode_id')) {
        return;
      }

      // game_modes was created by initDb before this runs, with triviandom seeded.
      // Recreate leaderboard with mode_id NOT NULL FK using SQLite's canonical
      // table-rebuild pattern (https://sqlite.org/lang_altertable.html).
      db.exec(`
        CREATE TABLE leaderboard_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          answers INTEGER NOT NULL,
          time_ms INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          mode_id INTEGER NOT NULL REFERENCES game_modes(id)
        );

        INSERT INTO leaderboard_new (id, name, answers, time_ms, created_at, mode_id)
        SELECT id, name, answers, time_ms, created_at,
               (SELECT id FROM game_modes WHERE slug = 'triviandom')
        FROM leaderboard;

        DROP TABLE leaderboard;
        ALTER TABLE leaderboard_new RENAME TO leaderboard;

        CREATE INDEX idx_leaderboard_mode_score
          ON leaderboard(mode_id, answers DESC, time_ms ASC);
      `);
    },
  },
  {
    id: '003_add_confirmation_token_expires',
    up: (db) => {
      // On fresh DBs, users table doesn't exist yet (created by initAuthDb after
      // migrations). The CREATE TABLE in auth.ts already includes the column.
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
        .all();
      if (tables.length === 0) return;
      const cols = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
      if (cols.some((c) => c.name === 'confirmation_token_expires')) {
        return;
      }
      db.exec('ALTER TABLE users ADD COLUMN confirmation_token_expires INTEGER');
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
