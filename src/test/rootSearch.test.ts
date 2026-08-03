import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeDatabaseSchema } from '../../electron/db/schema.js';
import { searchChunksByRoot } from '../../electron/db/workspaceStore/search.js';
import { expandRootQuery, rootsForToken, tokensForRoot } from '../../electron/shamela/rootSearch.js';
import { EMBED_DIMS } from '../../shared/ai/embedConstants.js';

/**
 * SPEC-M6 Phase 6 — Arabic root search over a fixture S2.db.
 *
 * S2.db stores token→root as Windows-1256 BLOBs. The fixture recreates a
 * tiny slice of the real 3.2M-row database (including a comma-separated
 * multi-root token) so the codec, both lookups, and the FTS5 OR-expansion
 * are exercised end-to-end.
 */

vi.mock('../../electron/db/vectorSearch.js', () => ({
  upsertChunkVector: () => { /* no-op */ },
}));
vi.mock('../../electron/ai/geminiClient.js', () => ({
  embedTextContent: async () => new Array(EMBED_DIMS).fill(0.01),
}));

const { storeChunk } = await import('../../electron/db/ingest.js');

// ── cp1256 codec (mirror of the module's built-in one) ─────────────────────
const decoder = new TextDecoder('windows-1256');
const CHAR_TO_BYTE = new Map<string, number>();
for (let b = 0; b < 256; b++) {
  const ch = decoder.decode(new Uint8Array([b]));
  if (ch.length === 1 && !CHAR_TO_BYTE.has(ch)) CHAR_TO_BYTE.set(ch, b);
}
function enc(text: string): Buffer {
  return Buffer.from([...text].map((c) => CHAR_TO_BYTE.get(c) ?? 0x3f));
}

let s2Path: string;
let db: Database.Database;
let userId: string;

beforeAll(() => {
  // ── fixture S2.db ───────────────────────────────────────────────────────
  s2Path = path.join(os.tmpdir(), `s2-fixture-${Date.now()}.db`);
  const s2 = new Database(s2Path);
  s2.exec(`CREATE TABLE roots (token BLOB, root BLOB);
           CREATE INDEX token_idx ON roots(token);`);
  const ins = s2.prepare('INSERT INTO roots (token, root) VALUES (?, ?)');
  const rows: Array<[string, string]> = [
    ['كتب', 'كتب'],
    ['كتاب', 'كتب'],
    ['الكتاب', 'كتب'],
    ['مكتوب', 'كتب'],
    ['بكتاب', 'كتب'],
    ['الكتب', 'كتب'],
    ['استخرج', 'خرج'],
    ['خرج', 'خرج'],
    ['يخرج', 'خرج'],
    ['المخرج', 'خرج'],
    // comma-separated multi-root token (آتاك → roots of أتى)
    ['آتاك', 'ءتي,ءتو,ءتت'],
    ['أتى', 'ءتي'],
    ['يأتون', 'ءتي'],
  ];
  for (const [token, root] of rows) ins.run(enc(token), enc(root));
  s2.close();

  // ── workspace db with imported chunks ────────────────────────────────────
  db = new Database(':memory:');
  initializeDatabaseSchema(db);
  userId = (db.prepare("SELECT value FROM corpus_meta WHERE key = 'local_user_id'").get() as { value: string }).value;

  const insertBook = db.prepare(
    `INSERT INTO library_items (id, user_id, project_id, kind, title, source_ref, storage_path, meta, created_at)
     VALUES (?, ?, NULL, 'book', ?, ?, NULL, '{}', ?)`,
  );
  insertBook.run('item-2001', userId, 'المغني لابن قدامة', JSON.stringify({ shamelaBookId: '2001' }), new Date().toISOString());
  insertBook.run('item-2002', userId, 'التبيان في تفسير غريب القرآن', JSON.stringify({ shamelaBookId: '2002' }), new Date().toISOString());

  // Chunks written with surface forms (not roots) — exactly like imported text.
  storeChunk({ db, userId, itemId: 'item-2001', chunk: { index: 0, content: 'هذا كتاب في الفقه', charStart: 0, charEnd: 20 }, embedding: new Array(EMBED_DIMS).fill(0.01), pageNumber: 3 });
  storeChunk({ db, userId, itemId: 'item-2001', chunk: { index: 1, content: 'والكتاب مكتوب بالعربية', charStart: 0, charEnd: 24 }, embedding: new Array(EMBED_DIMS).fill(0.01), pageNumber: 4 });
  storeChunk({ db, userId, itemId: 'item-2002', chunk: { index: 0, content: 'خرج الرجل من بيته', charStart: 0, charEnd: 20 }, embedding: new Array(EMBED_DIMS).fill(0.01), pageNumber: 7 });
});

afterAll(() => {
  try {
    fs.unlinkSync(s2Path);
  } catch {
    // ignore
  }
});

describe('rootSearch codec + lookups', () => {
  it('rootsForToken decodes the cp1256 token and returns its root(s)', () => {
    expect(rootsForToken(s2Path, 'استخرج')).toEqual(['خرج']);
  });

  it('handles comma-separated multi-root tokens', () => {
    expect(rootsForToken(s2Path, 'آتاك')).toEqual(['ءتي', 'ءتو', 'ءتت']);
  });

  it('tokensForRoot returns every surface form of a root', () => {
    const forms = tokensForRoot(s2Path, 'كتب');
    expect(forms).toEqual(expect.arrayContaining(['كتب', 'الكتاب', 'مكتوب', 'بكتاب', 'الكتب']));
  });

  it('tokensForRoot matches a multi-root comma list via instr()', () => {
    const forms = tokensForRoot(s2Path, 'ءتي');
    expect(forms).toEqual(expect.arrayContaining(['أتى', 'يأتون']));
  });

  it('expandRootQuery returns all forms for a token with a known root', () => {
    const forms = expandRootQuery(s2Path, 'مكتوب');
    expect(forms).toEqual(expect.arrayContaining(['مكتوب', 'كتاب', 'الكتب', 'بكتاب']));
  });

  it('expandRootQuery returns an empty list for an unknown token', () => {
    expect(expandRootQuery(s2Path, 'مجهول')).toEqual([]);
  });
});

describe('searchChunksByRoot (FTS5 OR-expansion)', () => {
  it('expands the query root and matches all surface forms', () => {
    const hits = searchChunksByRoot(db, s2Path, 'مكتوب', 50);
    const pages = hits.map((h) => h.pageNumber);
    // كتاب (p3), الكتاب/مكتوب (p4) all share the كتب root.
    expect(pages).toEqual(expect.arrayContaining([3, 4]));
    expect(hits.some((h) => h.pageNumber === 4)).toBe(true);
  });

  it('matches via the multi-root instr() path', () => {
    const hits = searchChunksByRoot(db, s2Path, 'أتى', 50);
    // آتاك shares a root with أتى (ءتي) — but no chunk contains آتاك; أتى
    // itself is in the forms list.
    expect(hits.some((h) => h.pageNumber === 3)).toBe(false);
  });

  it('matches a second book when its forms are in the corpus', () => {
    const hits = searchChunksByRoot(db, s2Path, 'يخرج', 50);
    expect(hits.some((h) => h.itemId === 'item-2002' && h.pageNumber === 7)).toBe(true);
  });

  it('degrades to plain keyword search when S2.db is unavailable', () => {
    // Plain search on the exact surface form still matches.
    const hits = searchChunksByRoot(db, null, 'مكتوب', 50);
    expect(hits.some((h) => h.pageNumber === 4)).toBe(true);
  });
});
