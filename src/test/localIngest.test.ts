// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { EMBED_DIMS } from '../../shared/ai/embedConstants';

// electron/db/ingest.ts reaches Electron only through fileStore (app.getPath)
// and geminiClient (the BYOK key). Both are stubbed so the test exercises the
// real chunking, SQLite writes and resume arithmetic.
const files = new Map<string, Buffer>();
let embedCalls = 0;
let embedFails = false;
/** Fail every embed call after this many have succeeded (null = never). */
let embedFailAfter: number | null = null;

vi.mock('../../electron/db/fileStore.js', () => ({
  readLibraryFile: (p: string) => files.get(p) ?? null,
  writeLibraryFile: (p: string, b: Buffer) => { files.set(p, b); return p; },
  deleteLibraryFile: (p: string) => { files.delete(p); },
}));

vi.mock('../../electron/ai/geminiClient.js', () => ({
  embedTextContent: async () => {
    embedCalls++;
    if (embedFails || (embedFailAfter !== null && embedCalls > embedFailAfter)) throw new Error('quota exhausted');
    return new Array(EMBED_DIMS).fill(0.01);
  },
}));

// sqlite-vec is not loaded here, so vector writes take the brute-force
// fallback table (library_chunk_embeddings) — the same path a user gets when
// the extension fails to load (SPEC-M5 FR-4.3).
vi.mock('../../electron/db/vectorSearch.js', () => ({
  upsertChunkVector: (db: any, chunkId: string, embedding: number[]) => {
    db.prepare('INSERT OR REPLACE INTO library_chunk_embeddings (chunk_id, embedding) VALUES (?, ?)')
      .run(chunkId, Buffer.from(new Float32Array(embedding).buffer));
  },
}));

const { ingestLibraryItem } = await import('../../electron/db/ingest.js');

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

function addItem(db: any, text: string, id = 'item-1') {
  files.set('books/a.txt', Buffer.from(text, 'utf8'));
  db.prepare(`INSERT INTO library_items (id, user_id, title, storage_path, meta, created_at)
              VALUES (?, ?, 'کتاب', 'books/a.txt', '{}', '2026-01-01')`).run(id, USER);
  return id;
}

const meta = (db: any, id: string) =>
  JSON.parse(db.prepare('SELECT meta FROM library_items WHERE id = ?').get(id).meta);

const chunkCount = (db: any, id: string) =>
  db.prepare('SELECT COUNT(*) c FROM library_chunks WHERE library_item_id = ?').get(id).c;

describe('ingestLibraryItem (SPEC-M5.9 FR-1)', () => {
  beforeEach(() => {
    files.clear();
    embedCalls = 0;
    embedFails = false;
    embedFailAfter = null;
  });

  it('answers with the same shape the edge function returns', async () => {
    const db = makeDb();
    const id = addItem(db, 'ایک چھوٹی سی کتاب۔');

    const res = await ingestLibraryItem(db as any, { itemId: id });

    expect(Object.keys(res).sort()).toEqual(
      ['done', 'inserted', 'item_id', 'next_offset', 'progress', 'total_chunks'].sort(),
    );
    expect(res.done).toBe(true);
    expect(res.progress).toBe(100);
    expect(res.item_id).toBe(id);
  });

  it('stores a chunk row and a vector for every chunk', async () => {
    const db = makeDb();
    const id = addItem(db, 'جملہ۔ '.repeat(2000));

    const res = await ingestLibraryItem(db as any, { itemId: id });

    expect(chunkCount(db, id)).toBe(res.next_offset);
    const vectors = db.prepare('SELECT COUNT(*) c FROM library_chunk_embeddings').get() as { c: number };
    expect(vectors.c).toBe(res.next_offset);
  });

  it('marks the item ready and drops the cached text when finished', async () => {
    const db = makeDb();
    const id = addItem(db, 'مختصر متن۔');

    await ingestLibraryItem(db as any, { itemId: id });

    const ingest = meta(db, id).ingest;
    expect(ingest.status).toBe('ready');
    expect(ingest.progress).toBe(100);
    expect(ingest.extracted_text).toBeUndefined();
  });

  it('resumes from next_offset instead of re-embedding finished chunks', async () => {
    const db = makeDb();
    const id = addItem(db, 'جملہ۔ '.repeat(2000));

    const first = await ingestLibraryItem(db as any, { itemId: id, batchSize: 3 });
    expect(first.done).toBe(false);
    expect(first.next_offset).toBe(3);
    expect(meta(db, id).ingest.extracted_text).toBeTypeOf('string');

    const callsAfterFirst = embedCalls;
    const second = await ingestLibraryItem(db as any, {
      itemId: id, offset: first.next_offset, batchSize: 3,
    });

    expect(second.next_offset).toBe(6);
    // Exactly one embedding per new chunk — nothing already stored is redone.
    expect(embedCalls - callsAfterFirst).toBe(3);
  });

  it('keeps work already committed when cancelled mid-batch', async () => {
    const db = makeDb();
    const id = addItem(db, 'جملہ۔ '.repeat(2000));

    const signal = { aborted: false };
    let seen = 0;
    const originalPrepare = db.prepare.bind(db);
    // Trip the abort after two chunk inserts have landed. The FTS5 keyword
    // index insert (library_chunks_fts) is not a chunk insert — exclude it.
    (db as any).prepare = (sql: string) => {
      if (sql.includes('INSERT INTO library_chunks') && !sql.includes('library_chunks_fts') && ++seen === 2) signal.aborted = true;
      return originalPrepare(sql);
    };

    const res = await ingestLibraryItem(db as any, { itemId: id, batchSize: 10, signal });

    expect(res.done).toBe(false);
    expect(res.inserted).toBe(2);
    expect(chunkCount(db, id)).toBe(2);
    // Not a failure: the run is resumable exactly where it stopped.
    expect(meta(db, id).ingest.status).toBe('embedding');
    expect(meta(db, id).ingest.next_offset).toBe(2);
  });

  it('completes an item whose text yields no chunks', async () => {
    const db = makeDb();
    const id = addItem(db, '    ');

    const res = await ingestLibraryItem(db as any, { itemId: id });

    expect(res).toMatchObject({ done: true, total_chunks: 0, inserted: 0 });
    expect(embedCalls).toBe(0);
  });

  it('refuses an item belonging to another user', async () => {
    const db = makeDb();
    addItem(db, 'متن۔');
    db.prepare("UPDATE library_items SET user_id = 'somebody-else' WHERE id = 'item-1'").run();

    await expect(ingestLibraryItem(db as any, { itemId: 'item-1' }))
      .rejects.toThrow(/not found or access denied/);
  });

  it('reports a missing file instead of ingesting the failure marker', async () => {
    const db = makeDb();
    const id = addItem(db, 'متن۔');
    files.clear();

    await expect(ingestLibraryItem(db as any, { itemId: id })).rejects.toThrow(/Could not read file/);
    expect(chunkCount(db, id)).toBe(0);
    expect(meta(db, id).ingest.status).toBe('failed');
  });

  it('leaves earlier chunks in place when embedding fails part-way', async () => {
    const db = makeDb();
    const id = addItem(db, 'جملہ۔ '.repeat(2000));

    await ingestLibraryItem(db as any, { itemId: id, batchSize: 2 });
    embedFails = true;

    await expect(
      ingestLibraryItem(db as any, { itemId: id, offset: 2, batchSize: 2 }),
    ).rejects.toThrow(/quota exhausted/);

    // The first batch is still committed and still resumable.
    expect(chunkCount(db, id)).toBe(2);
    expect(meta(db, id).ingest.next_offset).toBe(2);
  });

  // A failed embed used to leave no trace on the item: no `failed` status, no error, no
  // resume point. The library row kept its default green "saved" over zero chunks (found by
  // uploading a book in the desktop app with no Gemini key configured).
  describe('an embedding failure is recorded on the item', () => {
    const text = 'جملہ۔ '.repeat(2000);

    it('REGRESSION: a failure on the very first chunk marks the item failed, with the reason', async () => {
      const db = makeDb();
      const id = addItem(db, text);
      embedFails = true;

      await expect(ingestLibraryItem(db as any, { itemId: id })).rejects.toThrow(/quota exhausted/);

      const ingest = meta(db, id).ingest;
      expect(ingest.status).toBe('failed');
      expect(ingest.error).toMatch(/quota exhausted/);
      expect(ingest.next_offset).toBe(0);
      expect(ingest.chunker).toBe('adaptive-v1');
      expect(chunkCount(db, id)).toBe(0);
    });

    it('records how far it got when the failure comes part-way through a batch', async () => {
      const db = makeDb();
      const id = addItem(db, text);
      embedFailAfter = 3;

      await expect(ingestLibraryItem(db as any, { itemId: id, batchSize: 10 })).rejects.toThrow(/quota exhausted/);

      expect(chunkCount(db, id)).toBe(3);
      const ingest = meta(db, id).ingest;
      expect(ingest.status).toBe('failed');
      expect(ingest.next_offset).toBe(3);
      expect(ingest.progress).toBeGreaterThan(0);
    });

    it('resumes from the recorded point and finishes without re-embedding what is stored', async () => {
      const db = makeDb();
      const id = addItem(db, text);
      embedFailAfter = 3;
      await expect(ingestLibraryItem(db as any, { itemId: id, batchSize: 100 })).rejects.toThrow();
      const { next_offset, total_chunks } = meta(db, id).ingest;

      embedFailAfter = null;
      embedCalls = 0;
      const res = await ingestLibraryItem(db as any, { itemId: id, offset: next_offset, batchSize: 100 });

      expect(res.done).toBe(true);
      expect(embedCalls).toBe(total_chunks - next_offset); // only the missing chunks were embedded
      expect(chunkCount(db, id)).toBe(total_chunks);
      const ingest = meta(db, id).ingest;
      expect(ingest.status).toBe('ready');
      expect(ingest.extracted_text).toBeUndefined(); // the book text is not kept once finished
    });
  });
});
