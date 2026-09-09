/**
 * Reader for the جوامع الكلم (JKHSSN) proprietary column-store at
 * `<install>/Data/HadithDB`.
 *
 * Format (decoded & verified 2026-09-10 — see ADR-0045):
 *
 *   <HadithDB>/
 *     Catalog.xml                    master table list
 *     <Table>/
 *       Catalog.xml                  <Field Name= Type= CustomType= …/> + <Query>
 *       <Column>/
 *         records.bin                the column data (see below)
 *         records.bin.ind / .ord     sort permutations — NOT offsets, ignored
 *         records.bin.inf            16 bytes, unused
 *         RecordsWC.bin              FTS word index (text cols only) — ignored
 *
 *   records.bin, by field Type:
 *     - Type 3  (adInteger)  → int32 LE array, N entries. N = filesize / 4.
 *     - Type 11 (adBoolean)  → 1 byte per row, N bytes.
 *     - Type 200/201/202/203 (text):
 *         CustomType "0" → [cp1256 text][trailer]. trailer = (N+1) entries of
 *           8 bytes at `filesize - (N+1)*8`; entry i's first u32 LE is the start
 *           byte offset of record i; record i = text[start(i) .. start(i+1)).
 *         CustomType "1" | "3" → compressed (format not cracked). `assertReadable`
 *           throws; the indexer skips these and the renderer resolves the value
 *           from Supabase instead.
 *
 * `node:fs` / `node:path` only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { decodeCp1256 } from './cp1256.js';

export type JkhssnFieldType = 'int32' | 'bool' | 'text' | 'unknown';

export interface JkhssnField {
  name: string;
  /** The raw ADO `Type` attribute. */
  adoType: number;
  kind: JkhssnFieldType;
  /** "0" = plain, "1"/"3" = compressed, null = absent. */
  customType: string | null;
  readable: boolean;
}

export interface JkhssnTableCatalog {
  table: string;
  dir: string;
  fields: JkhssnField[];
  originatingQuery: string | null;
}

const TEXT_ADO_TYPES = new Set([129, 130, 200, 201, 202, 203]);

function kindFor(adoType: number): JkhssnFieldType {
  if (adoType === 3 || adoType === 2 || adoType === 20) return 'int32';
  if (adoType === 11) return 'bool';
  if (TEXT_ADO_TYPES.has(adoType)) return 'text';
  return 'unknown';
}

/** Parse a table's `Catalog.xml` (regex — the files are tiny and fixed-shape). */
export function parseTableCatalog(tableDir: string): JkhssnTableCatalog {
  const table = path.basename(tableDir);
  const xmlPath = path.join(tableDir, 'Catalog.xml');
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const fields: JkhssnField[] = [];
  for (const m of xml.matchAll(/<Field\b[^>]*\/>/g)) {
    const tag = m[0];
    const attr = (k: string): string | null => {
      const mm = tag.match(new RegExp(`\\b${k}="([^"]*)"`));
      return mm ? mm[1] : null;
    };
    const name = attr('Name');
    if (!name) continue;
    const adoType = Number(attr('Type') ?? '0');
    const customType = attr('CustomType');
    const kind = kindFor(adoType);
    fields.push({
      name,
      adoType,
      kind,
      customType,
      readable: kind === 'int32' || kind === 'bool' || (kind === 'text' && customType === '0'),
    });
  }
  const q = xml.match(/<Query>([\s\S]*?)<\/Query>/);
  return { table, dir: tableDir, fields, originatingQuery: q ? q[1].trim() : null };
}

function columnDir(tableDir: string, col: string): string {
  return path.join(tableDir, col, 'records.bin');
}

/** Row count of a table — the byte length of any int32 column divided by 4. */
export function tableRowCount(cat: JkhssnTableCatalog): number {
  const numeric = cat.fields.find((f) => f.kind === 'int32');
  if (!numeric) throw new Error(`${cat.table}: no int32 column to size the table from`);
  return fs.statSync(columnDir(cat.dir, numeric.name)).size / 4;
}

/** Read one int32 LE column as an `Int32Array` (row count = filesize / 4). */
export function readInt32Column(tableDir: string, col: string): Int32Array {
  const buf = fs.readFileSync(columnDir(tableDir, col));
  const n = buf.length >> 2;
  // Copy into a fresh, 4-aligned ArrayBuffer so we can view it directly (LE
  // host assumed — every target is x64/arm64 little-endian).
  const ab = new ArrayBuffer(n * 4);
  new Uint8Array(ab).set(buf.subarray(0, n * 4));
  return new Int32Array(ab);
}

/** Read one boolean column as a `Uint8Array` (1 byte per row, 0/1). */
export function readBoolColumn(tableDir: string, col: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(columnDir(tableDir, col)));
}

export class CompressedColumnError extends Error {
  constructor(table: string, col: string) {
    super(`${table}/${col}: CustomType compressed — not readable, resolve from Supabase`);
    this.name = 'CompressedColumnError';
  }
}

/** Throw unless a text column is plain CP1256 (`CustomType="0"`). */
export function assertReadable(cat: JkhssnTableCatalog, col: string): void {
  const f = cat.fields.find((x) => x.name === col);
  if (!f) throw new Error(`${cat.table}: no such column ${col}`);
  if (f.kind === 'text' && f.customType !== '0') throw new CompressedColumnError(cat.table, col);
}

/**
 * Read one plain-text (`CustomType="0"`) column as `string[]`, one entry per
 * row, decoded from CP1256. `rows` must be the table row count (from
 * `tableRowCount`) — the trailer is `(rows+1)*8` bytes at the end of the file.
 */
export function readTextColumn(tableDir: string, col: string, rows: number): string[] {
  const buf = fs.readFileSync(columnDir(tableDir, col));
  const trailerBytes = (rows + 1) * 8;
  const textEnd = buf.length - trailerBytes;
  if (textEnd < 0) {
    throw new Error(`${path.basename(tableDir)}/${col}: file too short for ${rows} rows (${buf.length} bytes)`);
  }
  const offAt = (i: number): number => buf.readUInt32LE(textEnd + i * 8);
  if (offAt(0) !== 0 || offAt(rows) !== textEnd) {
    throw new Error(
      `${path.basename(tableDir)}/${col}: trailer inconsistent ` +
        `(start[0]=${offAt(0)}, start[${rows}]=${offAt(rows)}, textEnd=${textEnd})`,
    );
  }
  const out = new Array<string>(rows);
  for (let i = 0; i < rows; i++) out[i] = decodeCp1256(buf, offAt(i), offAt(i + 1));
  return out;
}

/** List every table directory under a HadithDB root (has a `Catalog.xml`). */
export function listTables(hadithDbRoot: string): string[] {
  return fs
    .readdirSync(hadithDbRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(hadithDbRoot, e.name, 'Catalog.xml')))
    .map((e) => e.name)
    .sort();
}
