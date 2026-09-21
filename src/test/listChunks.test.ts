// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

/**
 * `listChunks` on both backends (Chunk Inspector, ADR 0055 Phase 3b).
 *
 * The cloud version was first written selecting `page_number, part_number`.
 * Those columns exist ONLY in the desktop SQLite table (schema.ts: "Local-only:
 * not in Postgres"), so PostgREST rejected the query — and the error was
 * swallowed into `[]`, so every web user saw an empty inspector. Nothing tested
 * it. These tests pin the columns to what Postgres actually has.
 */

// ── cloud ────────────────────────────────────────────────────────────────────
const cloud = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; select?: string; eq?: [string, unknown]; range?: [number, number]; order?: [string, unknown] }>,
  result: { data: [] as unknown[], error: null as null | { message: string } },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const call: (typeof cloud.calls)[number] = { table };
      cloud.calls.push(call);
      const chain: any = {
        select: (cols: string) => { call.select = cols; return chain; },
        eq: (c: string, v: unknown) => { call.eq = [c, v]; return chain; },
        order: (c: string, o: unknown) => { call.order = [c, o]; return chain; },
        range: (a: number, b: number) => { call.range = [a, b]; return Promise.resolve(cloud.result); },
      };
      return chain;
    },
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ warn: () => {}, error: () => {}, info: () => {}, debug: () => {} }) } }));

const { cloudLibrary } = await import('../core/backend/cloud/library');

/** Columns of public.library_chunks (src/integrations/supabase/types.ts). */
const POSTGRES_COLUMNS = ['char_end', 'char_start', 'chunk_index', 'content', 'created_at', 'embedding', 'id', 'language', 'library_item_id', 'meta', 'user_id'];

describe('cloudLibrary.listChunks', () => {
  beforeEach(() => {
    cloud.calls = [];
    cloud.result = { data: [], error: null };
  });

  it('REGRESSION: selects only columns that exist in Postgres', async () => {
    await cloudLibrary.listChunks('item-1');
    const cols = cloud.calls[0].select!.split(',').map((c) => c.trim());
    for (const c of cols) expect(POSTGRES_COLUMNS, `column "${c}" does not exist in library_chunks`).toContain(c);
    expect(cols).not.toContain('page_number');
    expect(cols).not.toContain('part_number');
  });

  it('reads the item\'s own chunks in order', async () => {
    await cloudLibrary.listChunks('item-1', 25, 50);
    expect(cloud.calls[0]).toMatchObject({ table: 'library_chunks', eq: ['library_item_id', 'item-1'], order: ['chunk_index', { ascending: true }], range: [50, 74] });
  });

  it('REGRESSION: a failed query throws instead of looking like an empty book', async () => {
    cloud.result = { data: null as never, error: { message: 'column library_chunks.page_number does not exist' } };
    await expect(cloudLibrary.listChunks('item-1')).rejects.toThrow(/does not exist/);
  });

  it('returns page/part as null (they are desktop-only) so the shape matches the local backend', async () => {
    cloud.result = { data: [{ id: 'c1', chunk_index: 0, content: 'x', char_start: 0, char_end: 1, meta: {}, created_at: 't' }], error: null };
    const [row] = await cloudLibrary.listChunks('item-1');
    expect(row.page_number).toBeNull();
    expect(row.part_number).toBeNull();
    expect(row.content).toBe('x');
  });

  it('caps a single page (a book can be tens of thousands of chunks)', async () => {
    await cloudLibrary.listChunks('item-1', 100_000, 0);
    const [from, to] = cloud.calls[0].range!;
    expect(to - from + 1).toBeLessThanOrEqual(200);
  });

  it('survives nonsense limit/offset', async () => {
    await cloudLibrary.listChunks('item-1', Number.NaN, -5);
    const [from, to] = cloud.calls[0].range!;
    expect(from).toBe(0);
    expect(to).toBeGreaterThanOrEqual(0);
  });
});

// ── local ────────────────────────────────────────────────────────────────────
vi.mock('../../electron/db/fileStore.js', () => ({ deleteLibraryFile: () => {} }));
const { listChunks } = await import('../../electron/db/workspaceStore/library.js');

const USER = 'local-user-1';
function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE corpus_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE library_chunks (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, library_item_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL, content TEXT NOT NULL, language TEXT DEFAULT 'ur',
      char_start INTEGER, char_end INTEGER, page_number INTEGER, part_number INTEGER,
      meta TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
      UNIQUE (library_item_id, chunk_index)
    );
  `);
  db.prepare('INSERT INTO corpus_meta (key, value) VALUES (?, ?)').run('local_user_id', USER);
  return db;
}
const addChunk = (db: Database.Database, item: string, i: number, over: Record<string, unknown> = {}, user = USER) =>
  db.prepare(`INSERT INTO library_chunks (id, user_id, library_item_id, chunk_index, content, char_start, char_end, page_number, part_number, meta, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-01-01')`)
    .run(`${item}-${i}`, user, item, i, `chunk ${i}`, i * 10, i * 10 + 9, (over.page as number) ?? null, (over.part as number) ?? null, (over.meta as string) ?? '{}');

describe('local listChunks', () => {
  it('returns chunks in index order with structural meta parsed', () => {
    const db = makeDb();
    addChunk(db, 'a', 1, { meta: '{"kind":"fiqh","heading":"باب"}', page: 7 });
    addChunk(db, 'a', 0, { meta: '{"kind":"hadith","isnad":"حدثنا"}' });
    const rows = listChunks(db as never, 'a');
    expect(rows.map((r) => r.chunk_index)).toEqual([0, 1]);
    expect(rows[0].meta).toEqual({ kind: 'hadith', isnad: 'حدثنا' });
    expect(rows[1]).toMatchObject({ page_number: 7, part_number: null, char_start: 10, char_end: 19 });
  });

  it('REGRESSION: one corrupt meta value does not break the whole listing', () => {
    const db = makeDb();
    addChunk(db, 'a', 0, { meta: '{not json' });
    addChunk(db, 'a', 1, { meta: '{"kind":"prose"}' });
    const rows = listChunks(db as never, 'a');
    expect(rows).toHaveLength(2);
    expect(rows[0].meta).toEqual({});
    expect(rows[1].meta).toEqual({ kind: 'prose' });
  });

  it('pages with limit and offset', () => {
    const db = makeDb();
    for (let i = 0; i < 10; i++) addChunk(db, 'a', i);
    expect(listChunks(db as never, 'a', 3, 4).map((r) => r.chunk_index)).toEqual([4, 5, 6]);
  });

  it('caps a single page and tolerates nonsense limit/offset', () => {
    const db = makeDb();
    for (let i = 0; i < 250; i++) addChunk(db, 'a', i);
    expect(listChunks(db as never, 'a', 100_000).length).toBe(200);
    expect(listChunks(db as never, 'a', Number.NaN, -3).length).toBeGreaterThan(0);
  });

  it('never returns another item\'s or another user\'s chunks', () => {
    const db = makeDb();
    addChunk(db, 'a', 0);
    addChunk(db, 'b', 0);
    addChunk(db, 'a', 1, {}, 'someone-else');
    const rows = listChunks(db as never, 'a');
    expect(rows.map((r) => r.id)).toEqual(['a-0']);
  });
});
