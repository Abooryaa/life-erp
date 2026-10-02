import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { MIGRATIONS_DIR } from '../paths';
import * as schema from './schema';

export type DB = BetterSQLite3Database<typeof schema>;

interface DbState {
  file: string;
  sqlite: Database.Database;
  db: DB;
}

let state: DbState | null = null;

export class DatabaseError extends Error {}

function configure(sqlite: Database.Database) {
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
}

/** Open (or reopen) the database file and bring its schema up to date. */
export function openDb(file: string): DB {
  closeDb();
  let sqlite: Database.Database;
  try {
    sqlite = new Database(file);
    configure(sqlite);
    const check = sqlite.pragma('quick_check', { simple: true });
    if (check !== 'ok') throw new DatabaseError(`Database integrity check failed: ${String(check)}`);
  } catch (err) {
    throw new DatabaseError(
      `Could not open the database at ${file}. ${(err as Error).message}. ` +
        'Restore from a backup (npm run restore) if the file is damaged.',
    );
  }
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  state = { file, sqlite, db };
  for (const fn of openHooks) fn();
  return db;
}

const openHooks: (() => void)[] = [];
/** Run after every (re)open — e.g. seeding defaults into a freshly created or restored database. */
export function afterDbOpen(fn: () => void) {
  openHooks.push(fn);
}

export function closeDb() {
  if (!state) return;
  try {
    state.sqlite.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    /* closing anyway */
  }
  state.sqlite.close();
  state = null;
}

export function getDb(): DB {
  if (!state) throw new DatabaseError('Database is not open');
  return state.db;
}

export function getSqlite(): Database.Database {
  if (!state) throw new DatabaseError('Database is not open');
  return state.sqlite;
}

export function isDbOpen() {
  return state !== null;
}

/** Run a function inside a single SQLite transaction (all-or-nothing). */
export function tx<T>(fn: (db: DB) => T): T {
  const sqlite = getSqlite();
  return sqlite.transaction(() => fn(getDb()))();
}
