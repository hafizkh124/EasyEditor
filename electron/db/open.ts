import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

export type SqliteDatabase = InstanceType<typeof Database>;

let dbInstance: SqliteDatabase | null = null;

export function getDbPath(): string {
  return path.join(app.getPath('userData'), 'workspace.sqlite');
}

/**
 * Opens or returns the singleton SQLite database instance.
 * Enables WAL mode, foreign keys, and loads the sqlite-vec extension.
 */
export function openWorkspaceDatabase(customPath?: string): SqliteDatabase {
  if (dbInstance && !customPath) {
    return dbInstance;
  }

  const dbPath = customPath || getDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);

  // Performance & integrity pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  // Load sqlite-vec extension
  try {
    sqliteVec.load(db);
  } catch (err) {
    console.warn('sqlite-vec extension loading warning:', err);
  }

  if (!customPath) {
    dbInstance = db;
  }

  return db;
}

export function closeWorkspaceDatabase(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // Ignore cleanup error
    }
    dbInstance = null;
  }
}
