// @vitest-environment node
import { describe, it, expect, beforeAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDatabaseSchema } from '../../electron/db/schema.js';
import { searchChunks } from '../../electron/db/workspaceStore/search.js';
import { EMBED_DIMS } from '../../shared/ai/embedConstants.js';

/**
 * SPEC-M6 Phase 5 — FTS5 keyword search over imported chunks.
 *
 * Runs the REAL schema (initializeDatabaseSchema) on an in-memory database so
 * the FTS5 virtual table and backfill guard are exercised, then ingests chunks
 * through the REAL storeChunk (which normalizes and indexes them). This covers
 * the storage + retrieval contract end-to-end.
 */

let embedCalls = 0;
vi.mock('../../electron/db/vectorSearch.js', () => ({
  upsertChunkVector: (_db: any, _chunkId: string, _embedding: number[]) => { /* no-op */ },
}));

vi.mock('../../electron/ai/geminiClient.js', () => ({
  embedTextContent: async () => {
    embedCalls++;
    return new Array(EMBED_DIMS).fill(0.01);
  },
}));

const { storeChunk } = await import('../../electron/db/ingest.js');

let db: Database.Database;
let userId: string;

function insertBook(id: string, title: string) {
  db.prepare(
    `INSERT INTO library_items (id, user_id, project_id, kind, title, source_ref, storage_path, meta, created_at)
     VALUES (?, ?, NULL, 'book', ?, ?, NULL, '{}', ?)`,
  ).run(id, userId, title, JSON.stringify({ shamelaBookId: id.replace('item-', '') }), new Date().toISOString());
}

function addChunk(bookId: string, index: number, content: string, page: number) {
  storeChunk({
    db,
    userId,
    itemId: bookId,
    chunk: { index, content, charStart: 0, charEnd: content.length },
    embedding: new Array(EMBED_DIMS).fill(0.01),
    pageNumber: page,
  });
}

beforeAll(() => {
  db = new Database(':memory:');
  initializeDatabaseSchema(db);
  userId = (db.prepare("SELECT value FROM corpus_meta WHERE key = 'local_user_id'").get() as { value: string }).value;

  insertBook('item-1001', 'ذخائر العقبى في مناقب ذوي القربى');
  addChunk('item-1001', 0, 'هذا كتاب في مناقب أهل البيت عليهم السلام', 5);
  addChunk('item-1001', 1, 'وفيه ذكر الحسن والحسين رضي الله عنهما', 6);
});

describe('searchChunks (FTS5)', () => {
  it('returns page + item for a keyword match', () => {
    const hits = searchChunks(db, 'مناقب', 50);
    expect(hits.length).toBeGreaterThan(0);
    const hit = hits[0];
    expect(hit.itemId).toBe('item-1001');
    expect(hit.pageNumber).toBe(5);
    expect(hit.sourceRef.shamelaBookId).toBe('1001');
  });

  it('is diacritic-insensitive (Arabic harakat do not break a match)', () => {
    const hits = searchChunks(db, 'مَنَاقِب', 50);
    expect(hits.some((h) => h.pageNumber === 5)).toBe(true);
  });

  it('matches substrings across a conjunction (الحسين matches والحسين)', () => {
    const hits = searchChunks(db, 'الحسين', 50);
    expect(hits.some((h) => h.pageNumber === 6)).toBe(true);
  });

  it('matches a later chunk for a two-word query', () => {
    const hits = searchChunks(db, 'الحسن الحسين', 50);
    expect(hits.some((h) => h.pageNumber === 6)).toBe(true);
  });

  it('returns nothing for a non-matching keyword', () => {
    expect(searchChunks(db, 'القرافي', 50).length).toBe(0);
  });
});

describe('searchChunks (LIKE fallback)', () => {
  it('returns results even without the FTS5 table', () => {
    db.exec('DROP TABLE library_chunks_fts');
    const hits = searchChunks(db, 'مناقب', 50);
    expect(hits.some((h) => h.pageNumber === 5)).toBe(true);
  });
});
