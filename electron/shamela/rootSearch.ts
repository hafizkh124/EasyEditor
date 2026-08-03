import fs from 'node:fs';
import Database from 'better-sqlite3';

/**
 * SPEC-M6 Phase 6 — Arabic root search over Shamela's S2.db.
 *
 * S2.db (`database/service/S2.db`, ~3.2M rows) maps every morphological token
 * to the Arabic triliteral root(s) it derives from, stored as Windows-1256
 * bytes in BLOB columns `(token, root)`. Root lists are comma-separated, so a
 * single token can belong to several roots (e.g. آتاك → "ءتي,ءتو,ءتت").
 *
 * The lookup works both ways:
 *   - token → roots: a word typed by the user, to find its root(s)
 *   - root  → tokens: every surface form derived from a root, to expand a
 *     keyword search to all morphological variants
 *
 * Encoding note: no iconv dependency — Node's built-in TextDecoder
 * ('windows-1256') handles decode, and a reverse table built from it handles
 * encode. Verified round-trip on the full Arabic block.
 */

// ── cp1256 codec (no external dependency) ───────────────────────────────────

const cp1256Decoder = new TextDecoder('windows-1256');

const CP1256_BYTE_TO_CHAR: string[] = [];
for (let b = 0; b < 256; b++) {
  CP1256_BYTE_TO_CHAR[b] = cp1256Decoder.decode(new Uint8Array([b]));
}

const CP1256_CHAR_TO_BYTE = new Map<string, number>();
for (let b = 0; b < 256; b++) {
  const ch = CP1256_BYTE_TO_CHAR[b];
  if (ch.length === 1 && !CP1256_CHAR_TO_BYTE.has(ch)) {
    CP1256_CHAR_TO_BYTE.set(ch, b);
  }
}

function decodeCp1256(buf: Uint8Array): string {
  return cp1256Decoder.decode(buf);
}

function encodeCp1256(text: string): Buffer {
  const out = Buffer.alloc(text.length);
  for (let i = 0; i < text.length; i++) {
    const byte = CP1256_CHAR_TO_BYTE.get(text[i]);
    if (byte === undefined) {
      // Non-cp1256 characters (Latin letters, digits, spaces) encode as-is in
      // ASCII — S2.db only ever holds Arabic/Urdu, but be safe for queries.
      out[i] = text.charCodeAt(i) <= 0x7f ? text.charCodeAt(i) : 0x3f; // '?'
    } else {
      out[i] = byte;
    }
  }
  return out;
}

// ── S2.db access ────────────────────────────────────────────────────────────

const dbCache = new Map<string, Database.Database>();

function openS2Db(s2DbPath: string): Database.Database {
  if (!s2DbPath || !fs.existsSync(s2DbPath)) {
    throw new Error('Shamela root database (S2.db) not found.');
  }
  let db = dbCache.get(s2DbPath);
  if (!db) {
    db = new Database(s2DbPath, { readonly: true });
    dbCache.set(s2DbPath, db);
  }
  return db;
}

/** Close any cached S2.db handles (used on app quit / path change). */
export function closeRootDb(): void {
  for (const db of dbCache.values()) {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
  dbCache.clear();
}

/**
 * The root(s) a surface form derives from, e.g. استخرج → ["خرج"].
 * Returns [] when the token is unknown to S2.db.
 */
export function rootsForToken(s2DbPath: string, token: string): string[] {
  const db = openS2Db(s2DbPath);
  const row = db.prepare('SELECT root FROM roots WHERE token = ?').get(encodeCp1256(token)) as
    | { root: Buffer | Uint8Array | null }
    | undefined;
  if (!row?.root) return [];
  return decodeCp1256(Buffer.from(row.root)).split(',').filter(Boolean);
}

/**
 * Every surface form whose root list contains `root`, e.g. كتب →
 * [الكتاب, مكتوب, بكتاب, …]. `instr()` does byte-level matching so multi-root
 * comma lists are handled correctly (LIKE on BLOB is unreliable here).
 */
export function tokensForRoot(s2DbPath: string, root: string, limit = 2000): string[] {
  const db = openS2Db(s2DbPath);
  const rootBytes = encodeCp1256(root);
  const exact = rootBytes;
  const guarded = Buffer.from([0x2c, ...rootBytes, 0x2c]);   // ,root,
  const starts = Buffer.from([...rootBytes, 0x2c]);           // root,
  const ends = Buffer.from([0x2c, ...rootBytes]);             // ,root

  const rows = db.prepare(
    `SELECT token FROM roots
     WHERE root = ? OR instr(root, ?) > 0 OR instr(root, ?) > 0 OR instr(root, ?) > 0
     LIMIT ?`,
  ).all(exact, guarded, starts, ends, limit) as Array<{ token: Buffer | Uint8Array | null }>;

  const seen = new Set<string>();
  for (const r of rows) {
    if (r.token) {
      const t = decodeCp1256(Buffer.from(r.token));
      if (t) seen.add(t);
    }
  }
  return [...seen];
}

/**
 * Expand a user query to every morphological form sharing its root. The query
 * is treated as a surface token first; if S2 doesn't know it, the query is
 * tried as a root directly. Returns the expanded form list (possibly just the
 * query itself when no root information exists).
 */
export function expandRootQuery(s2DbPath: string, query: string, limit = 2000): string[] {
  const token = query.trim();
  if (!token) return [];

  const roots = rootsForToken(s2DbPath, token);
  if (roots.length > 0) {
    const forms = new Set<string>();
    for (const root of roots) {
      for (const form of tokensForRoot(s2DbPath, root, limit)) forms.add(form);
    }
    return [...forms];
  }

  // Unknown token — maybe the user typed a root directly.
  return tokensForRoot(s2DbPath, token, limit);
}
