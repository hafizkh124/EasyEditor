/**
 * `jkhssn.sqlite` — open/close helpers.
 *
 * Two consumers:
 *  - the runtime axes (`axes.ts`) open it read-only, singleton, cached by path;
 *  - `buildIndex.ts` opens a fresh writable handle at a temp path.
 *
 * It is a SEPARATE database from `workspace.sqlite` — rebuilt wholesale from the
 * جوامع الكلم source (or shipped as a seed), never migrated in place.
 */
import Database from 'better-sqlite3';
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { JKHSSN_INDEX_FILE } from '../../shared/jkhssn/constants.js';

export type SqliteDatabase = InstanceType<typeof Database>;

export { openJkhssnBuildDb } from './buildDb.js';

/** Default location of the built index. */
export function jkhssnIndexPath(): string {
  return path.join(app.getPath('userData'), JKHSSN_INDEX_FILE);
}

/** Location of the shipped seed inside the packaged app, if present. */
export function jkhssnSeedPath(): string | null {
  const appPath = typeof app.getAppPath === 'function' ? app.getAppPath() : '';
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'data', JKHSSN_INDEX_FILE) : '',
    appPath ? path.join(appPath, 'resources', 'data', JKHSSN_INDEX_FILE) : '',
  ];
  return candidates.find((p) => p && fs.existsSync(p)) ?? null;
}

let roInstance: SqliteDatabase | null = null;
let roPath: string | null = null;

/** Read-only singleton, for the axis queries. */
export function getJkhssnDb(indexPath?: string): SqliteDatabase {
  const target = indexPath ?? jkhssnIndexPath();
  if (roInstance && roPath === target) return roInstance;
  if (roInstance) {
    try { roInstance.close(); } catch { /* ignore */ }
    roInstance = null;
  }
  if (!fs.existsSync(target)) throw new Error(`jkhssn.sqlite not found at: ${target}`);
  const db = new Database(target, { readonly: true });
  db.pragma('query_only = ON');
  roInstance = db;
  roPath = target;
  return db;
}

export function closeJkhssnDb(): void {
  if (roInstance) {
    try { roInstance.close(); } catch { /* ignore */ }
    roInstance = null;
    roPath = null;
  }
}
