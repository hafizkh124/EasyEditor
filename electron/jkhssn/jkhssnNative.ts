/**
 * JKHSSN (جامع خادم الحرمين / جوامع الكلم) — installation detection + the built
 * index's status. Mirrors `electron/shamela/shamelaNative.ts`.
 *
 * ADR-0007 rule: detect by a readable key file, never a registry uninstall
 * entry. Key file = `<root>/Data/HadithDB/Catalog.xml`.
 */
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  JKHSSN_CANDIDATE_ROOTS,
  JKHSSN_CONFIG_FILE,
  JKHSSN_DISCOVERY_KEY,
  JKHSSN_HADITHDB_SUBPATH,
  JKHSSN_INDEX_SCHEMA_VERSION,
} from '../../shared/jkhssn/constants.js';
import type { JkhssnDiagnostics, JkhssnStatus } from '../../shared/jkhssn/types.js';
import { logger } from '../lib/logger.js';
import { getJkhssnDb, jkhssnIndexPath, jkhssnSeedPath } from './indexDb.js';
import { listTables } from './columnStore.js';

const log = logger.child('jkhssn/native');

function configPath(): string {
  return path.join(app.getPath('userData'), JKHSSN_CONFIG_FILE);
}

export function getSavedJkhssnPath(): string | null {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    const v = JSON.parse(raw) as { jkhssnPath?: string };
    return typeof v.jkhssnPath === 'string' && v.jkhssnPath.trim() ? v.jkhssnPath : null;
  } catch {
    return null;
  }
}

export function saveJkhssnPath(p: string): void {
  const existing = (() => {
    try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')) as Record<string, unknown>; }
    catch { return {}; }
  })();
  fs.writeFileSync(configPath(), JSON.stringify({ ...existing, jkhssnPath: p }, null, 2), 'utf8');
}

/** `<hadithDbRoot>` if it contains the discovery key, else null. */
function hadithDbFrom(root: string): string | null {
  const direct = fs.existsSync(path.join(root, JKHSSN_DISCOVERY_KEY)) ? root : null;
  if (direct) return direct;
  const nested = path.join(root, JKHSSN_HADITHDB_SUBPATH);
  return fs.existsSync(path.join(nested, JKHSSN_DISCOVERY_KEY)) ? nested : null;
}

function resolveDataPath(): string | null {
  // Explicit override (power users, CI, tests) wins.
  const envPath = process.env.JKHSSN_DATA_PATH?.trim();
  if (envPath) {
    const hit = hadithDbFrom(envPath);
    if (hit) return hit;
  }
  const saved = getSavedJkhssnPath();
  // JKHSSN_NO_CANDIDATE_SCAN keeps detection hermetic in tests / sandboxes.
  const scan = process.env.JKHSSN_NO_CANDIDATE_SCAN ? [] : [...JKHSSN_CANDIDATE_ROOTS];
  const roots = saved ? [saved, ...scan] : scan;
  for (const root of roots) {
    try {
      const hit = hadithDbFrom(root);
      if (hit) return hit;
    } catch { /* unreadable candidate */ }
  }
  return null;
}

interface IndexMeta {
  path: string;
  schemaVersion: number | null;
  sourcePath: string | null;
  rowCounts: Record<string, number> | null;
}

function readIndexMeta(): IndexMeta | null {
  for (const p of [jkhssnIndexPath(), jkhssnSeedPath()].filter(Boolean) as string[]) {
    if (!fs.existsSync(p)) continue;
    try {
      const db = getJkhssnDb(p);
      const rows = db.prepare('SELECT key, value FROM meta').all() as Array<{ key: string; value: string }>;
      const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      return {
        path: p,
        schemaVersion: m.schema_version ? Number(m.schema_version) : null,
        sourcePath: m.source_path ?? null,
        rowCounts: m.row_counts ? (JSON.parse(m.row_counts) as Record<string, number>) : null,
      };
    } catch (err) {
      log.warn('index meta unreadable', { p, err: (err as Error).message });
    }
  }
  return null;
}

export async function detectJkhssnInstallation(): Promise<JkhssnStatus> {
  const dataPath = resolveDataPath();
  const catalogFound = dataPath ? fs.existsSync(path.join(dataPath, JKHSSN_DISCOVERY_KEY)) : false;
  const meta = readIndexMeta();

  const indexBuilt = meta != null;
  const indexStale =
    indexBuilt &&
    (meta!.schemaVersion !== JKHSSN_INDEX_SCHEMA_VERSION ||
      (dataPath != null && meta!.sourcePath != null && path.resolve(meta!.sourcePath) !== path.resolve(dataPath)));

  if (!dataPath && !indexBuilt) {
    return {
      installed: false,
      dataPath: null,
      catalogFound: false,
      indexPath: null,
      indexBuilt: false,
      indexStale: false,
      reason: 'جوامع الكلم انسٹال نہیں ملا۔ اگر انسٹال ہے تو ترتیبات → کنیکٹرز سے فولڈر منتخب کریں۔',
    };
  }

  return {
    installed: true,
    dataPath,
    catalogFound,
    indexPath: meta?.path ?? null,
    indexBuilt,
    indexStale,
    rowCounts: meta?.rowCounts ?? undefined,
    reason: !indexBuilt
      ? 'انڈیکس ابھی تیار نہیں — پہلی بار کنیکٹ ہونے پر خودکار بن جائے گا۔'
      : indexStale
        ? 'انڈیکس پرانا ہے — دوبارہ بنائیں۔'
        : undefined,
  };
}

export async function diagnoseJkhssnInstallation(): Promise<JkhssnDiagnostics> {
  const dataPath = resolveDataPath();
  const catalogFound = dataPath ? fs.existsSync(path.join(dataPath, JKHSSN_DISCOVERY_KEY)) : false;
  let readableTables = 0;
  if (dataPath) {
    try { readableTables = listTables(dataPath).length; } catch { /* ignore */ }
  }
  const meta = readIndexMeta();
  const errors: string[] = [];
  if (!dataPath) errors.push('HadithDB فولڈر نہیں ملا');
  else if (!catalogFound) errors.push('Catalog.xml موجود نہیں');
  if (!meta) errors.push('انڈیکس ابھی نہیں بنا');
  else if (meta.schemaVersion !== JKHSSN_INDEX_SCHEMA_VERSION) errors.push('انڈیکس کا اسکیما ورژن پرانا ہے');

  return {
    dataPathChecked: dataPath,
    catalogFound,
    readableTables,
    indexBuilt: meta != null,
    indexFresh: meta != null && meta.schemaVersion === JKHSSN_INDEX_SCHEMA_VERSION,
    indexSchemaVersion: meta?.schemaVersion ?? null,
    builtSchemaVersion: JKHSSN_INDEX_SCHEMA_VERSION,
    errors,
  };
}

/** The data path the index would be (re)built from, or null. */
export function jkhssnDataPath(): string | null {
  return resolveDataPath();
}
