// @vitest-environment node
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { EMBED_DIMS } from '../../shared/ai/embedConstants';

/**
 * Desktop "upload a book". Uses the REAL fileStore (a temp userData dir) and a real
 * SQLite database, because the defect lived exactly in the seam between them:
 * `uploadLibraryFile` only created an item that NAMED a file. Nothing ever wrote
 * the bytes (`writeLibraryFile` had no callers), so ingest read `null` and every
 * upload ended in "[Could not read file]" — the mock-based ingest tests stubbed
 * the file store and could not see it.
 */

let userData = '';
vi.mock('electron', () => ({ app: { getPath: () => userData, getVersion: () => '0.0.0', getAppPath: () => userData } }));
vi.mock('../../electron/ai/geminiClient.js', () => ({
  embedTextContent: async () => new Array(EMBED_DIMS).fill(0.01),
}));
vi.mock('../../electron/db/vectorSearch.js', () => ({
  upsertChunkVector: (db: any, chunkId: string, embedding: number[]) => {
    db.prepare('INSERT OR REPLACE INTO library_chunk_embeddings (chunk_id, embedding) VALUES (?, ?)')
      .run(chunkId, Buffer.from(new Float32Array(embedding).buffer));
  },
}));

const { createItem, storagePathForUpload, MAX_UPLOAD_BYTES } = await import('../../electron/db/workspaceStore/library.js');
const { deleteItem } = await import('../../electron/db/workspaceStore/library.js');
const { readLibraryFile } = await import('../../electron/db/fileStore.js');
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
    CREATE TABLE library_chunk_vec (chunk_id TEXT PRIMARY KEY);
    CREATE VIRTUAL TABLE library_chunks_fts USING fts5(
      search_text, library_item_id UNINDEXED, chunk_index UNINDEXED,
      page_number UNINDEXED, part_number UNINDEXED, tokenize = 'trigram'
    );
  `);
  db.prepare('INSERT INTO corpus_meta (key, value) VALUES (?, ?)').run('local_user_id', USER);
  return db;
}

const bytesOf = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'));
const filesDir = () => path.join(userData, 'files');

beforeEach(() => { userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-upload-')); });
afterEach(() => { fs.rmSync(userData, { recursive: true, force: true }); });

describe('createItem with uploaded bytes', () => {
  it('REGRESSION: stores the file and points the item at it (it used to store nothing)', () => {
    const db = makeDb();
    const item = createItem(db as any, { title: 'book.txt', kind: 'book', storage_path: 'book.txt' }, bytesOf('نص الكتاب'));

    expect(item.storage_path).toBe(`${item.id}/book.txt`);
    expect(fs.existsSync(path.join(filesDir(), item.id, 'book.txt'))).toBe(true);
    expect(readLibraryFile(item.storage_path!)?.toString('utf8')).toBe('نص الكتاب');
    expect((db.prepare('SELECT storage_path FROM library_items WHERE id = ?').get(item.id) as any).storage_path).toBe(item.storage_path);
  });

  it('REGRESSION: the uploaded book can then be ingested (end to end, real file, real db)', async () => {
    const db = makeDb();
    const hadith = 'حدثنا فلان قال حدثنا فلان عن رسول الله صلى الله عليه وسلم قال: قول أول.\nحدثنا ثان قال حدثنا آخر عن النبي صلى الله عليه وسلم قال: قول ثان.';
    const item = createItem(db as any, { title: 'hadith.txt', kind: 'book', storage_path: 'hadith.txt' }, bytesOf(hadith));

    const res = await ingestLibraryItem(db as any, { itemId: item.id });

    expect(res.done).toBe(true);
    expect(res.total_chunks).toBe(2); // adaptive hadith chunker: one per narration
    const rows = db.prepare('SELECT content FROM library_chunks WHERE library_item_id = ? ORDER BY chunk_index').all(item.id) as any[];
    expect(rows).toHaveLength(2);
    expect(rows[0].content).toContain('قول أول');
  });

  it('keeps an Arabic/Urdu file name and its extension', () => {
    const db = makeDb();
    const item = createItem(db as any, { title: 'کتاب الطہارة.txt', storage_path: 'کتاب الطہارة.txt' }, bytesOf('x'));
    expect(item.storage_path).toBe(`${item.id}/کتاب الطہارة.txt`);
    expect(readLibraryFile(item.storage_path!)).not.toBeNull();
  });

  it('a hostile file name cannot escape the files directory', () => {
    const db = makeDb();
    const item = createItem(db as any, { title: 'x', storage_path: '../../../evil.txt' }, bytesOf('x'));
    expect(item.storage_path).toBe(`${item.id}/evil.txt`);
    const abs = path.resolve(filesDir(), item.storage_path!);
    expect(abs.startsWith(filesDir() + path.sep)).toBe(true);
    expect(fs.existsSync(path.join(userData, 'evil.txt'))).toBe(false);
  });

  it('falls back to a placeholder for empty or dot-only names', () => {
    expect(storagePathForUpload('id1', '')).toBe('id1/file');
    expect(storagePathForUpload('id1', '..')).toBe('id1/file');
    expect(storagePathForUpload('id1', 'a\\b\\c.pdf')).toBe('id1/c.pdf');
    expect(storagePathForUpload('id1', 'a<b>:c?.txt')).toBe('id1/a_b__c_.txt');
  });

  it('a very long name keeps its extension', () => {
    const p = storagePathForUpload('id1', 'x'.repeat(400) + '.pdf');
    expect(p.endsWith('.pdf')).toBe(true);
    expect(p.length).toBeLessThan(140);
  });

  it('rejects an oversized upload before writing anything', () => {
    const db = makeDb();
    const huge = { byteLength: MAX_UPLOAD_BYTES + 1 } as unknown as Uint8Array;
    expect(() => createItem(db as any, { title: 'big.pdf', storage_path: 'big.pdf' }, huge)).toThrow(/too large/);
    expect(fs.existsSync(filesDir())).toBe(false);
    expect((db.prepare('SELECT COUNT(*) c FROM library_items').get() as any).c).toBe(0);
  });

  it('leaves no orphan file when the row cannot be inserted', () => {
    const db = makeDb();
    db.exec('DROP TABLE library_items'); // make the INSERT fail after the file was written
    expect(() => createItem(db as any, { id: 'lib-x', title: 'a.txt', storage_path: 'a.txt' }, bytesOf('x'))).toThrow();
    expect(fs.existsSync(path.join(filesDir(), 'lib-x', 'a.txt'))).toBe(false);
  });

  it('without bytes it behaves as before (Shamela import and notes create items with no file)', () => {
    const db = makeDb();
    const item = createItem(db as any, { title: 'note', kind: 'note' });
    expect(item.storage_path).toBeUndefined();
    expect(fs.existsSync(filesDir())).toBe(false);
  });

  it('deleting the item removes its file and its now-empty directory', () => {
    const db = makeDb();
    const item = createItem(db as any, { title: 'b.txt', storage_path: 'b.txt' }, bytesOf('x'));
    expect(fs.existsSync(path.join(filesDir(), item.id))).toBe(true);

    // deleteItem also clears vector/fts tables; create the ones it touches
    db.exec('CREATE TABLE IF NOT EXISTS library_chunk_vec (chunk_id TEXT)');
    deleteItem(db as any, item.id);

    expect(fs.existsSync(path.join(filesDir(), item.id, 'b.txt'))).toBe(false);
    expect(fs.existsSync(path.join(filesDir(), item.id))).toBe(false);
    expect(fs.existsSync(filesDir())).toBe(true); // the root itself is never removed
  });
});
