import fs from 'node:fs';
import path from 'node:path';
import type { SqliteDatabase } from '../open.js';
import { initializeDatabaseSchema } from '../schema.js';

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
 * Creates an automatic timestamped backup of the database file before running migrations.
 */
function createPreMigrationBackup(dbPath: string, currentVersion: number): string | null {
  if (!fs.existsSync(dbPath)) {
    return null;
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${dbPath}.bak.v${currentVersion}.${timestamp}`;
  try {
    fs.copyFileSync(dbPath, backupPath);
    console.log(`[DB Migration] Backup created at: ${backupPath}`);
    return backupPath;
  } catch (err) {
    console.error('[DB Migration] Failed to create pre-migration backup:', err);
    return null;
  }
}

/**
 * Runs versioned database migrations safely with automatic backups.
 */
export function runDatabaseMigrations(db: SqliteDatabase, dbPath: string): void {
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

  // Create automatic pre-migration backup before running pending migrations
  createPreMigrationBackup(dbPath, currentVersion);

  for (const migration of pendingMigrations) {
    console.log(`[DB Migration] Applying migration v${migration.version}: ${migration.name}`);
    db.transaction(() => {
      migration.up(db);
      setVersionStmt.run(String(migration.version));
    })();
  }
}
