/**
 * Build `jkhssn.sqlite` from the readable plain columns of the جوامع الكلم
 * column-store. Shared by the offline maintainer script
 * (`scripts/build-jkhssn-index.mjs`) and the runtime rebuild path, so a seed and
 * a runtime build can never diverge.
 *
 * Resilient by design: a missing/unreadable source table or column is logged
 * and skipped, never fatal — a partial index still powers most axes (ADR-0045).
 */
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { JKHSSN_INDEX_SCHEMA_VERSION } from '../../shared/jkhssn/constants.js';
import type { JkhssnIndexProgress } from '../../shared/jkhssn/types.js';
import { logger } from '../lib/logger.js';
import { openJkhssnBuildDb } from './buildDb.js';
import { JKHSSN_SCHEMA_SQL } from './schema.js';
import {
  parseTableCatalog,
  tableRowCount,
  readInt32Column,
  readBoolColumn,
  readTextColumn,
  type JkhssnTableCatalog,
} from './columnStore.js';
import {
  TABLE_MAPS,
  MATN_COMPARISON_SHARDS,
  SERVICE_STATE_SOURCE,
  SERVICE_STATE_FLAG_COLUMNS,
  FTS_SOURCES,
  type TableMap,
  type ColKind,
} from './tableMap.js';

const log = logger.child('jkhssn/buildIndex');

/**
 * `matn_comparison` (axis 4) is ~8M pairs and roughly doubles the index size.
 * It is OFF by default — axis 4 falls back to the Supabase matn corpora
 * (ADR-0045). Opt in with `BuildOptions.withMatnComparison`. The cap is a
 * secondary guard even when opted in.
 */
const MATN_COMPARISON_MAX_ROWS = 12_000_000;
const INSERT_BATCH = 2000;

/** `BookTOC_Hadith` has no Catalog.xml — its columns are hard-mapped here. */
const BOOK_TOC_COLUMNS: Array<{ from: string; to: string; kind: ColKind }> = [
  { from: 'ParagraphID', to: 'paragraph_id', kind: 'i' },
  { from: 'MainID', to: 'main_id', kind: 'i' },
  { from: 'ParentID', to: 'parent_id', kind: 'i' },
  { from: 'LeftValue', to: 'left_val', kind: 'i' },
  { from: 'RightValue', to: 'right_val', kind: 'i' },
  { from: 'IsLeaf', to: 'is_leaf', kind: 'b' },
  { from: 'IsParagraph', to: 'is_paragraph', kind: 'b' },
  { from: 'MosanefID', to: 'book_id', kind: 'i' },
  { from: 'PartNum', to: 'part_num', kind: 'i' },
  { from: 'PageNum', to: 'page_num', kind: 'i' },
  { from: 'SectionText', to: 'section_text', kind: 't' },
  { from: 'TarqeemMatboa1', to: 'tarqeem_matboa1', kind: 't' },
  { from: 'TarqeemMatboa2', to: 'tarqeem_matboa2', kind: 't' },
  { from: 'TarqeemHarf', to: 'tarqeem_harf', kind: 't' },
];

export interface BuildOptions {
  /** `…/Data/HadithDB`. */
  dataPath: string;
  /** Where to write the finished `jkhssn.sqlite`. A temp path is written then renamed. */
  outPath: string;
  /** Include the ~8M-pair matn-comparison table (axis 4). Doubles index size. */
  withMatnComparison?: boolean;
  onProgress?: (p: JkhssnIndexProgress) => void;
  signal?: { aborted: boolean };
}

export interface BuildResult {
  rowCounts: Record<string, number>;
  skipped: string[];
  elapsedMs: number;
}

type ColumnValues = Int32Array | Uint8Array | string[];

function readColumn(cat: JkhssnTableCatalog, kind: ColKind, from: string, rows: number): ColumnValues {
  if (kind === 'i') return readInt32Column(cat.dir, from);
  if (kind === 'b') return readBoolColumn(cat.dir, from);
  return readTextColumn(cat.dir, from, rows);
}

function valueAt(values: ColumnValues | null, row: number): number | string | null {
  if (values === null) return null;
  const v = (values as { [k: number]: number | string })[row];
  return v === undefined ? null : v;
}

function loadOneTable(db: Database.Database, dataPath: string, map: TableMap, onProgress?: BuildOptions['onProgress']): number {
  const dir = path.join(dataPath, map.source);
  if (!fs.existsSync(path.join(dir, 'Catalog.xml'))) throw new Error(`no Catalog.xml for ${map.source}`);
  const cat = parseTableCatalog(dir);
  const rows = tableRowCount(cat);

  const cols: Array<{ to: string; values: ColumnValues | null }> = [];
  for (const c of map.columns) {
    const field = cat.fields.find((f) => f.name === c.from);
    if (!field || !fs.existsSync(path.join(dir, c.from, 'records.bin'))) {
      // A جوامع الكلم version without this column — keep the row, store NULL.
      log.warn('column absent, stored NULL', { source: map.source, column: c.from });
      cols.push({ to: c.to, values: null });
      continue;
    }
    if (c.kind === 't' && field.customType !== '0') {
      // Compressed source text — keep the row, store NULL for this column
      // (the renderer resolves it from Supabase, ADR-0045).
      log.warn('column compressed, stored NULL', { source: map.source, column: c.from });
      cols.push({ to: c.to, values: null });
      continue;
    }
    cols.push({ to: c.to, values: readColumn(cat, c.kind, c.from, rows) });
  }

  const targetCols = cols.map((c) => c.to);
  const placeholders = targetCols.map(() => '?').join(',');
  const stmt = db.prepare(`INSERT INTO ${map.target} (${targetCols.join(',')}) VALUES (${placeholders})`);
  const insertMany = db.transaction((from: number, to: number) => {
    for (let r = from; r < to; r++) stmt.run(cols.map((c) => valueAt(c.values, r)));
  });

  for (let r = 0; r < rows; r += INSERT_BATCH) {
    const end = Math.min(rows, r + INSERT_BATCH);
    insertMany(r, end);
    if (onProgress) onProgress({ phase: 'write', table: map.target, done: end, total: rows });
  }
  return rows;
}

function loadServiceState(db: Database.Database, dataPath: string, onProgress?: BuildOptions['onProgress']): number {
  const dir = path.join(dataPath, SERVICE_STATE_SOURCE);
  const cat = parseTableCatalog(dir);
  const rows = tableRowCount(cat);
  const hmid = readInt32Column(dir, 'HadithMainID');
  const degree = cat.fields.some((f) => f.name === 'Degree') ? readInt32Column(dir, 'Degree') : null;
  // Bit i (in SERVICE_STATE_FLAG_COLUMNS order) — absent columns leave the bit 0.
  const flagArrays: Array<Uint8Array | null> = SERVICE_STATE_FLAG_COLUMNS.map((name) =>
    cat.fields.some((x) => x.name === name) ? readBoolColumn(dir, name) : null,
  );
  const stmt = db.prepare('INSERT OR REPLACE INTO service_state (hadith_main_id, degree, flags_bits) VALUES (?,?,?)');
  const tx = db.transaction((from: number, to: number) => {
    for (let r = from; r < to; r++) {
      let bits = 0;
      for (let b = 0; b < flagArrays.length; b++) if (flagArrays[b]?.[r]) bits |= 1 << b;
      stmt.run(hmid[r], degree ? degree[r] : null, bits);
    }
  });
  for (let r = 0; r < rows; r += INSERT_BATCH) {
    const end = Math.min(rows, r + INSERT_BATCH);
    tx(r, end);
    if (onProgress) onProgress({ phase: 'write', table: 'service_state', done: end, total: rows });
  }
  return rows;
}

function loadMatnComparison(db: Database.Database, dataPath: string, onProgress?: BuildOptions['onProgress']): number {
  // Size the union first.
  let total = 0;
  const shards: Array<{ dir: string; rows: number }> = [];
  for (let s = 1; s <= MATN_COMPARISON_SHARDS; s++) {
    const dir = path.join(dataPath, `HMatnComparison${s}`);
    if (!fs.existsSync(path.join(dir, 'Catalog.xml'))) continue;
    const rows = tableRowCount(parseTableCatalog(dir));
    shards.push({ dir, rows });
    total += rows;
  }
  if (total > MATN_COMPARISON_MAX_ROWS) {
    log.warn('matn_comparison too large, skipping', { total, cap: MATN_COMPARISON_MAX_ROWS });
    return 0;
  }
  const stmt = db.prepare('INSERT INTO matn_comparison (master_matn_id, slave_matn_id, match_sort) VALUES (?,?,?)');
  let done = 0;
  for (const { dir, rows } of shards) {
    const master = readInt32Column(dir, 'MasterMatnID');
    const slave = readInt32Column(dir, 'SlaveMatnID');
    const sort = readInt32Column(dir, 'MatchSort');
    const tx = db.transaction((from: number, to: number) => {
      for (let r = from; r < to; r++) stmt.run(master[r], slave[r], sort[r]);
    });
    for (let r = 0; r < rows; r += INSERT_BATCH) {
      const end = Math.min(rows, r + INSERT_BATCH);
      tx(r, end);
      done += end - r;
      if (onProgress) onProgress({ phase: 'write', table: 'matn_comparison', done, total });
    }
  }
  return total;
}

function loadBookToc(db: Database.Database, dataPath: string, onProgress?: BuildOptions['onProgress']): number {
  const dir = path.join(dataPath, 'BookTOC_Hadith');
  const idPath = path.join(dir, 'ParagraphID', 'records.bin');
  if (!fs.existsSync(idPath)) throw new Error('BookTOC_Hadith/ParagraphID missing');
  const rows = fs.statSync(idPath).size / 4;

  const cols: Array<{ to: string; values: ColumnValues | null }> = [];
  for (const c of BOOK_TOC_COLUMNS) {
    const colPath = path.join(dir, c.from, 'records.bin');
    if (!fs.existsSync(colPath)) { cols.push({ to: c.to, values: null }); continue; }
    try {
      if (c.kind === 'i') cols.push({ to: c.to, values: readInt32Column(dir, c.from) });
      else if (c.kind === 'b') cols.push({ to: c.to, values: readBoolColumn(dir, c.from) });
      else {
        const vals = readTextColumn(dir, c.from, rows);
        // Heuristic: BookTOC text cols with no catalog — accept only if a sample
        // decodes to mostly Arabic (Tarf/Content are compressed and would not).
        const sample = vals.slice(0, 400).filter(Boolean).join('');
        const arabic = (sample.match(/[؀-ۿ]/g) || []).length;
        cols.push({ to: c.to, values: sample.length > 40 && arabic / sample.length > 0.4 ? vals : null });
        if (sample.length > 40 && arabic / sample.length <= 0.4) {
          log.warn('BookTOC column looks compressed, stored NULL', { column: c.from });
        }
      }
    } catch (err) {
      log.warn('BookTOC column skipped', { column: c.from, err: (err as Error).message });
      cols.push({ to: c.to, values: null });
    }
  }

  const targetCols = cols.map((c) => c.to);
  const stmt = db.prepare(`INSERT INTO book_toc (${targetCols.join(',')}) VALUES (${targetCols.map(() => '?').join(',')})`);
  const tx = db.transaction((from: number, to: number) => {
    for (let r = from; r < to; r++) stmt.run(cols.map((c) => valueAt(c.values, r)));
  });
  for (let r = 0; r < rows; r += INSERT_BATCH) {
    const end = Math.min(rows, r + INSERT_BATCH);
    tx(r, end);
    if (onProgress) onProgress({ phase: 'write', table: 'book_toc', done: end, total: rows });
  }
  return rows;
}

function buildFts(db: Database.Database, onProgress?: BuildOptions['onProgress']): void {
  const insFts = db.prepare('INSERT INTO jkhssn_fts (rowid, text) VALUES (?, ?)');
  const insMap = db.prepare('INSERT INTO fts_map (fts_rowid, kind, ref_id) VALUES (?, ?, ?)');
  let rowid = 0;
  for (const src of FTS_SOURCES) {
    const rows = db
      .prepare(`SELECT ${src.refCol} AS ref, ${src.textCol} AS txt FROM ${src.target} WHERE ${src.textCol} IS NOT NULL AND ${src.textCol} != ''`)
      .all() as Array<{ ref: number; txt: string }>;
    const tx = db.transaction((batch: Array<{ ref: number; txt: string }>) => {
      for (const row of batch) {
        rowid += 1;
        insFts.run(rowid, row.txt);
        insMap.run(rowid, src.kind, row.ref);
      }
    });
    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
      tx(rows.slice(i, i + INSERT_BATCH));
      if (onProgress) onProgress({ phase: 'fts', table: src.kind, done: Math.min(i + INSERT_BATCH, rows.length), total: rows.length });
    }
  }
}

export async function buildJkhssnIndex(opts: BuildOptions): Promise<BuildResult> {
  const started = Date.now();
  const tmp = `${opts.outPath}.building-${process.pid}`;
  const db = openJkhssnBuildDb(tmp);
  const rowCounts: Record<string, number> = {};
  const skipped: string[] = [];

  try {
    db.exec(JKHSSN_SCHEMA_SQL);

    for (const map of TABLE_MAPS) {
      if (opts.signal?.aborted) throw new Error('aborted');
      try {
        if (opts.onProgress) opts.onProgress({ phase: 'read', table: map.target, done: 0, total: 0 });
        rowCounts[map.target] = loadOneTable(db, opts.dataPath, map, opts.onProgress);
      } catch (err) {
        log.warn('table skipped', { source: map.source, target: map.target, err: (err as Error).message });
        skipped.push(map.target);
      }
    }

    try { rowCounts.service_state = loadServiceState(db, opts.dataPath, opts.onProgress); }
    catch (err) { log.warn('service_state skipped', { err: (err as Error).message }); skipped.push('service_state'); }

    if (opts.withMatnComparison) {
      try { rowCounts.matn_comparison = loadMatnComparison(db, opts.dataPath, opts.onProgress); }
      catch (err) { log.warn('matn_comparison skipped', { err: (err as Error).message }); skipped.push('matn_comparison'); }
    } else {
      skipped.push('matn_comparison');
    }

    try { rowCounts.book_toc = loadBookToc(db, opts.dataPath, opts.onProgress); }
    catch (err) { log.warn('book_toc skipped', { err: (err as Error).message }); skipped.push('book_toc'); }

    // Fill narrator.name_shape from the most frequent form per narrator.
    try {
      db.exec(`
        UPDATE narrator SET
          name_shape = (SELECT name_shape FROM narrator_form f WHERE f.jk_rawy_id = narrator.jk_rawy_id ORDER BY frequency DESC LIMIT 1),
          name_shape_freq = (SELECT MAX(frequency) FROM narrator_form f WHERE f.jk_rawy_id = narrator.jk_rawy_id)
      `);
    } catch (err) {
      log.warn('name_shape rollup skipped', { err: (err as Error).message });
    }

    buildFts(db, opts.onProgress);

    // Record ACTUAL row counts (INSERT OR IGNORE / dup PKs mean the source row
    // count can overstate what landed) so the build guard compares like for like.
    const dataTables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('meta','fts_map') AND name NOT LIKE 'jkhssn_fts%' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;
    for (const { name } of dataTables) {
      rowCounts[name] = (db.prepare(`SELECT COUNT(*) n FROM ${name}`).get() as { n: number }).n;
    }

    const meta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?,?)');
    meta.run('schema_version', String(JKHSSN_INDEX_SCHEMA_VERSION));
    meta.run('source_path', opts.dataPath);
    meta.run('build_started_at', new Date(started).toISOString());
    meta.run('build_completed_at', new Date().toISOString());
    meta.run('builder_version', '1');
    meta.run('framing_model', 'trailing (N+1)*8 offset table, cp1256');
    meta.run('row_counts', JSON.stringify(rowCounts));
    meta.run('skipped', JSON.stringify(skipped));
    meta.run('service_state_flags', SERVICE_STATE_FLAG_COLUMNS.join(','));

    db.pragma('optimize');
    try { db.pragma('journal_mode = MEMORY'); db.exec('VACUUM'); } catch (err) { log.warn('vacuum skipped', { err: (err as Error).message }); }
    db.close();

    if (fs.existsSync(opts.outPath)) fs.rmSync(opts.outPath);
    fs.renameSync(tmp, opts.outPath);
  } catch (err) {
    try { db.close(); } catch { /* ignore */ }
    try { if (fs.existsSync(tmp)) fs.rmSync(tmp); } catch { /* ignore */ }
    throw err;
  }

  if (opts.onProgress) opts.onProgress({ phase: 'done', table: '', done: 1, total: 1 });
  const result: BuildResult = { rowCounts, skipped, elapsedMs: Date.now() - started };
  log.info('jkhssn index built', { elapsedMs: result.elapsedMs, skipped: result.skipped.join(',') });
  return result;
}
