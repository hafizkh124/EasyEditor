import fs from 'node:fs';
import path from 'node:path';
import type { SqliteDatabase } from '../open.js';
import { initializeDatabaseSchema } from '../schema.js';
import { logger } from "../../lib/logger.js";

const log = logger.child("runner");

export interface Migration {
  version: number;
  name: string;
  up: (db: SqliteDatabase) => void;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: '001_initial_schema',
    up: (db) => {
      initializeDatabaseSchema(db);
    },
  },
];

/**
 * Creates an automatic timestamped backup of the database file before running
 * migrations, using better-sqlite3's own `backup()` rather than a raw file
 * copy. The DB runs in WAL mode (electron/db/open.ts), so a plain
 * `fs.copyFileSync` of the main file alone can miss committed data still
 * sitting in the `-wal` file — a "backup" that is silently incomplete is
 * worse than no backup (SPEC-M5 risk R14).
 *
 * Throws on failure rather than swallowing the error: proceeding with a
 * migration when the safety net could not be created defeats the point of
 * having one.
 */
async function createPreMigrationBackup(db: SqliteDatabase, dbPath: string, currentVersion: number): Promise<string | null> {
  if (!fs.existsSync(dbPath)) {
    return null;
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${dbPath}.bak.v${currentVersion}.${timestamp}`;
  await db.backup(backupPath);
  log.info("backup created", { backupPath });
  return backupPath;
}

/**
 * Runs versioned database migrations safely with automatic backups.
 */
export async function runDatabaseMigrations(db: SqliteDatabase, dbPath: string): Promise<void> {
  // Ensure corpus_meta exists to read schema_version
  db.exec(`CREATE TABLE IF NOT EXISTS corpus_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);

  const getVersionStmt = db.prepare("SELECT value FROM corpus_meta WHERE key = 'schema_version'");
  const setVersionStmt = db.prepare("INSERT OR REPLACE INTO corpus_meta (key, value) VALUES ('schema_version', ?)");

  const row = getVersionStmt.get() as { value: string } | undefined;
  const currentVersion = row ? parseInt(row.value, 10) : 0;

  const pendingMigrations = MIGRATIONS.filter((m) => m.version > currentVersion).sort(
    (a, b) => a.version - b.version,
  );

  if (pendingMigrations.length === 0) {
    // Schema up to date, just ensure base schema is initialized
    initializeDatabaseSchema(db);
    return;
  }

  // Create automatic pre-migration backup before running pending migrations.
  // A failure here throws and aborts the migration (see the comment above).
  await createPreMigrationBackup(db, dbPath, currentVersion);

  for (const migration of pendingMigrations) {
    log.info("applying migration", { version: migration.version, name: migration.name });
    db.transaction(() => {
      migration.up(db);
      setVersionStmt.run(String(migration.version));
    })();
  }
}
