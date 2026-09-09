/**
 * Writable `jkhssn.sqlite` handle for a one-shot bulk build. Electron-free so
 * the offline maintainer script (`scripts/build-jkhssn-index.mts`) and the
 * runtime rebuild share it.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type SqliteDatabase = InstanceType<typeof Database>;

/** Fresh writable handle, tuned for a bulk load (no journal, no fsync). */
export function openJkhssnBuildDb(outPath: string): SqliteDatabase {
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(outPath)) fs.rmSync(outPath);
  const db = new Database(outPath);
  db.pragma('journal_mode = OFF');
  db.pragma('synchronous = OFF');
  db.pragma('temp_store = MEMORY');
  db.pragma('page_size = 4096');
  return db;
}
