import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { EMBED_DIMS } from '../../shared/ai/embedConstants';
import { estimateChunksForChars } from '../../electron/shamela/estimate';

// Only the two Electron-bound edges are stubbed: reading Shamela's Lucene
// index and calling Gemini. Chunking, page mapping and the SQLite
// writes are the real thing.
let pagesByBook: Record<string, Array<{ page: string; text: string }>> = {};
let embedCalls = 0;
let readBookSpawns = 0;
/** Set to make the next readShamelaBook fail, as a broken install would. */
let readBookError: string | null = null;

vi.mock('../../electron/shamela/shamelaNative.js', () => ({
  readShamelaBook: async (
    bookId: string,
    onPage: (p: { page: string; text: string }) => boolean | void,
  ) => {
    readBookSpawns++;
    if (readBookError) throw new Error(readBookError);
    const pages = pagesByBook[bookId] ?? [];
    for (const page of pages) {
      if (onPage(page) === false) break;
    }
    return { pageCount: pages.length };
  },
}));

vi.mock('../../electron/ai/geminiClient.js', () => ({
  embedTextContent: async () => {
    embedCalls++;
    return new Array(EMBED_DIMS).fill(0.02);
  },
}));

vi.mock('../../electron/db/vectorSearch.js', () => ({
  upsertChunkVector: (db: any, chunkId: string, embedding: number[]) => {
    db.prepare('INSERT OR REPLACE INTO library_chunk_embeddings (chunk_id, embedding) VALUES (?, ?)')
      .run(chunkId, Buffer.from(new Float32Array(embedding).buffer));
  },
}));

const { importShamelaBooks, findImportedItem, filterAlreadyImported } =
  await import('../../electron/shamela/import.js');

const USER = 'local-user-1';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE corpus_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE library_items (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT, kind TEXT,
      title TEXT NOT NULL, source_ref TEXT DEFAULT '{}', storage_path TEXT,
      meta TEXT NOT NULL DEFAULT '{}', created_at TEXT, updated_at TEXT
    );
    CREATE TABLE library_chunks (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, library_item_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL, content TEXT NOT NULL, language TEXT DEFAULT 'ur',
      char_start INTEGER, char_end INTEGER, page_number INTEGER, part_number INTEGER,
      meta TEXT DEFAULT '{}', created_at TEXT,
      UNIQUE (library_item_id, chunk_index)
    );
    CREATE TABLE library_chunk_embeddings (chunk_id TEXT PRIMARY KEY, embedding BLOB NOT NULL);
    CREATE VIRTUAL TABLE library_chunks_fts USING fts5(
      search_text, library_item_id UNINDEXED, chunk_index UNINDEXED,
      page_number UNINDEXED, part_number UNINDEXED, tokenize = 'trigram'
    );
  `);
  db.prepare('INSERT INTO corpus_meta (key, value) VALUES (?, ?)').run('local_user_id', USER);
  return db;
}

const chunksOf = (db: any, itemId: string) =>
  db.prepare('SELECT * FROM library_chunks WHERE library_item_id = ? ORDER BY chunk_index').all(itemId);

const BOOK = { id: 42, title: 'صحيح البخاري', author: 'البخاري' };

describe('importShamelaBooks (SPEC-M5.9 FR-2)', () => {
  beforeEach(() => {
    pagesByBook = {};
    embedCalls = 0;
    readBookSpawns = 0;
    readBookError = null;
  });

  it('creates a shamela library item carrying the book’s identity', async () => {
    pagesByBook['42'] = [{ page: '1', text: 'إنما الأعمال بالنيات' }];
    const db = makeDb();

    const res = await importShamelaBooks({ db: db as any, books: [BOOK] });

    expect(res.imported).toBe(1);
    const item = db.prepare('SELECT * FROM library_items').get() as any;
    expect(item.title).toBe('صحيح البخاري');
    // Provenance lives in source_ref, not in a Shamela-specific `kind`:
    // Postgres constrains kind to a fixed set and the local schema mirrors it.
    expect(item.kind).toBe('book');
    expect(JSON.parse(item.source_ref)).toMatchObject({ shamelaBookId: 42, author: 'البخاري' });
  });

  it('records page on every chunk — the citation depends on it', async () => {
    pagesByBook['42'] = [
      { page: '15', text: 'نص الصفحة الأولى' },
      { page: '16', text: 'نص الصفحة الثانية' },
    ];
    const db = makeDb();

    const res = await importShamelaBooks({ db: db as any, books: [BOOK] });
    const chunks = chunksOf(db, res.items[0].libraryItemId);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].page_number).toBe(15);
    expect(chunks[1].page_number).toBe(16);
  });

  it('numbers chunks continuously across page boundaries', async () => {
    pagesByBook['42'] = [
      { page: '1', text: 'أ'.repeat(3000) },
      { page: '2', text: 'ب'.repeat(3000) },
    ];
    const db = makeDb();

    const res = await importShamelaBooks({ db: db as any, books: [BOOK] });
    const chunks = chunksOf(db, res.items[0].libraryItemId);

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.map((c: any) => c.chunk_index)).toEqual(chunks.map((_: any, i: number) => i));
  });

  it('strips Shamela’s page markup down to prose', async () => {
    pagesByBook['42'] = [{
      page: '1',
      text: '<p>إنما <b>الأعمال</b></p><br/>&nbsp;بالنيات',
    }];
    const db = makeDb();

    const res = await importShamelaBooks({ db: db as any, books: [BOOK] });
    const [chunk] = chunksOf(db, res.items[0].libraryItemId);

    expect(chunk.content).not.toContain('<');
    expect(chunk.content).toContain('إنما');
    expect(chunk.content).toContain('بالنيات');
  });

  it('reads a whole book in a single JVM spawn (risk N4)', async () => {
    pagesByBook['42'] = Array.from({ length: 40 }, (_, i) => ({
      page: String(i + 1), text: `صفحة ${i + 1}`,
    }));
    const db = makeDb();

    await importShamelaBooks({ db: db as any, books: [BOOK] });

    // 40 pages, one spawn — not one per page.
    expect(readBookSpawns).toBe(1);
  });

  it('skips a book already imported instead of spending again', async () => {
    pagesByBook['42'] = [{ page: '1', text: 'نص' }];
    const db = makeDb();

    await importShamelaBooks({ db: db as any, books: [BOOK] });
    const callsAfterFirst = embedCalls;

    const second = await importShamelaBooks({ db: db as any, books: [BOOK] });

    expect(second.imported).toBe(0);
    expect(embedCalls).toBe(callsAfterFirst);
    expect(db.prepare('SELECT COUNT(*) c FROM library_items').get()).toEqual({ c: 1 });
  });

  it('reports which of a set are already imported', async () => {
    pagesByBook['42'] = [{ page: '1', text: 'نص' }];
    const db = makeDb();
    await importShamelaBooks({ db: db as any, books: [BOOK] });

    expect(filterAlreadyImported(db as any, [42, 99])).toEqual([42]);
    expect(findImportedItem(db as any, 99)).toBeNull();
  });

  it('keeps finished books when cancelled part-way through the selection', async () => {
    pagesByBook['1'] = [{ page: '1', text: 'كتاب أول' }];
    pagesByBook['2'] = [{ page: '1', text: 'كتاب ثان' }];
    const db = makeDb();

    const signal = { aborted: false };
    const res = await importShamelaBooks({
      db: db as any,
      books: [{ id: 1, title: 'الأول' }, { id: 2, title: 'الثاني' }],
      signal,
      onProgress: (p) => { if (p.status === 'done' && p.bookIndex === 1) signal.aborted = true; },
    });

    expect(res.cancelled).toBe(true);
    expect(res.imported).toBe(1);
    // The first book is complete and stays complete.
    const items = db.prepare('SELECT * FROM library_items').all() as any[];
    expect(items).toHaveLength(1);
    expect(JSON.parse(items[0].meta).ingest.status).toBe('ready');
  });

  it('reports progress per book with its position in the selection', async () => {
    pagesByBook['1'] = [{ page: '1', text: 'نص' }];
    pagesByBook['2'] = [{ page: '1', text: 'نص' }];
    const db = makeDb();

    const seen: string[] = [];
    await importShamelaBooks({
      db: db as any,
      books: [{ id: 1, title: 'الأول' }, { id: 2, title: 'الثاني' }],
      onProgress: (p) => seen.push(`${p.bookIndex}/${p.totalBooks}:${p.status}`),
    });

    expect(seen).toContain('1/2:reading');
    expect(seen).toContain('2/2:done');
  });

  it('marks the item failed and rethrows when a book cannot be read', async () => {
    const db = makeDb();
    // Risk R15: a broken install must surface its reason, not a silent
    // half-import that looks like an empty book.
    readBookError = 'شاملہ کی Java Runtime (JRE) نہیں ملی۔';

    await expect(importShamelaBooks({ db: db as any, books: [BOOK] }))
      .rejects.toThrow(/Java Runtime/);

    const item = db.prepare('SELECT meta FROM library_items').get() as any;
    expect(JSON.parse(item.meta).ingest.status).toBe('failed');
  });

  it('skips blank pages without spending an embedding on them', async () => {
    pagesByBook['42'] = [
      { page: '1', text: '   ' },
      { page: '2', text: '<p></p>' },
      { page: '3', text: 'نص حقيقي' },
    ];
    const db = makeDb();

    const res = await importShamelaBooks({ db: db as any, books: [BOOK] });

    expect(embedCalls).toBe(1);
    expect(chunksOf(db, res.items[0].libraryItemId)).toHaveLength(1);
  });
});

describe('estimateChunksForChars (FR-2.2)', () => {
  it('counts nothing for an empty book', () => {
    expect(estimateChunksForChars(0)).toBe(0);
  });

  it('counts one chunk for anything up to a single chunk’s worth', () => {
    expect(estimateChunksForChars(1)).toBe(1);
    expect(estimateChunksForChars(1200)).toBe(1);
  });

  it('grows with the overlap stride, not the raw chunk size', () => {
    // stride = 1200 - 150 = 1050
    expect(estimateChunksForChars(1200 + 1050)).toBe(2);
    expect(estimateChunksForChars(1200 + 1050 * 2)).toBe(3);
  });

  it('never under-counts a large book', () => {
    // 500 pages × 1800 chars — the estimate must not promise fewer requests
    // than a real chunking would make.
    expect(estimateChunksForChars(500 * 1800)).toBeGreaterThan(800);
  });
});
