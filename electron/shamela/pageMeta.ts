/**
 * M13 Phase 3 (ADR-0058) — bibliographic metadata for local Shamela 4 hits.
 *
 * The Lucene helper returns `<bookId>-<pageId>` where pageId is Shamela's
 * INTERNAL page id, and an empty title. A scholar cites author, title, volume
 * and PRINTED page. Both live in plain SQLite files, read-only:
 *   - database/master.db  book(book_id, book_name, book_date, main_author) +
 *                         author(author_id, author_name, death_number)
 *   - database/book/<id % 1000>/<id>.db  page(id, part, page, number)
 *     where page.id = the internal id, page.part = volume, page.page = printed page
 * (schema confirmed against D:\shamela4 on 2026-09-29).
 *
 * Every lookup is best-effort: a missing file or row leaves the hit as it was.
 */
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../lib/logger.js';
import { getShamelaBookDbPath } from './shamelaNative.js';
import { formatShamelaReference } from '../../shared/citation/shamelaFootnote.js';

const log = logger.child('shamela/pageMeta');

export interface BookMeta {
  title: string;
  author: string | null;
  deathYear: number | null;
  multiVolume: boolean;
}

export interface PageMeta {
  volume: string | null;
  printedPage: number | null;
}

type Db = { prepare: (sql: string) => { get: (...a: unknown[]) => unknown; all: (...a: unknown[]) => unknown[] }; close: () => void };
type DbCtor = new (file: string, opts: { readonly: boolean; fileMustExist?: boolean }) => Db;

let DatabaseCtor: DbCtor | null = null;
async function sqlite(): Promise<DbCtor> {
  if (!DatabaseCtor) DatabaseCtor = (await import('better-sqlite3')).default as unknown as DbCtor;
  return DatabaseCtor;
}

const bookCache = new Map<string, BookMeta | null>();
const BOOK_CACHE_MAX = 500;

/** Title/author/death for one book, plus whether it spans several volumes. */
export async function getBookMeta(libraryPath: string, bookId: string): Promise<BookMeta | null> {
  const key = `${libraryPath}|${bookId}`;
  if (bookCache.has(key)) return bookCache.get(key) ?? null;
  let meta: BookMeta | null = null;
  try {
    const Database = await sqlite();
    const master = path.join(libraryPath, 'database', 'master.db');
    if (fs.existsSync(master)) {
      const db = new Database(master, { readonly: true, fileMustExist: true });
      try {
        const row = db.prepare(
          `SELECT b.book_name AS title, COALESCE(a.author_name, b.authors) AS author,
                  COALESCE(a.death_number, b.book_date) AS death
             FROM book b LEFT JOIN author a ON b.main_author = a.author_id
            WHERE b.book_id = ?`,
        ).get(Number(bookId)) as { title?: string; author?: string | null; death?: number | null } | undefined;
        if (row?.title) {
          meta = { title: row.title, author: row.author ?? null, deathYear: row.death ?? null, multiVolume: false };
        }
      } finally { db.close(); }
    }
    const bookDb = getShamelaBookDbPath(libraryPath, bookId);
    if (meta && fs.existsSync(bookDb)) {
      const db = new Database(bookDb, { readonly: true, fileMustExist: true });
      try {
        const r = db.prepare('SELECT COUNT(DISTINCT part) AS n FROM page WHERE part IS NOT NULL AND part <> \'\'').get() as { n: number } | undefined;
        meta.multiVolume = (r?.n ?? 0) > 1;
      } finally { db.close(); }
    }
  } catch (err) {
    log.warn('book metadata lookup failed', { bookId, message: (err as Error).message });
  }
  if (bookCache.size >= BOOK_CACHE_MAX) bookCache.delete(bookCache.keys().next().value as string);
  bookCache.set(key, meta);
  return meta;
}

/** Volume + printed page for a set of internal page ids of one book. */
export async function getPageMeta(libraryPath: string, bookId: string, internalIds: number[]): Promise<Map<number, PageMeta>> {
  const out = new Map<number, PageMeta>();
  const ids = [...new Set(internalIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return out;
  const bookDb = getShamelaBookDbPath(libraryPath, bookId);
  if (!fs.existsSync(bookDb)) return out;
  try {
    const Database = await sqlite();
    const db = new Database(bookDb, { readonly: true, fileMustExist: true });
    try {
      const rows = db.prepare(`SELECT id, part, page FROM page WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as Array<{ id: number; part: string | null; page: number | null }>;
      for (const r of rows) out.set(r.id, { volume: r.part ?? null, printedPage: typeof r.page === 'number' ? r.page : null });
    } finally { db.close(); }
  } catch (err) {
    log.warn('page metadata lookup failed', { bookId, message: (err as Error).message });
  }
  return out;
}

/** Every page of one book: internal id → volume/printed page (for import). */
export async function getAllPageMeta(libraryPath: string, bookId: string): Promise<Map<number, PageMeta>> {
  const out = new Map<number, PageMeta>();
  const bookDb = getShamelaBookDbPath(libraryPath, bookId);
  if (!fs.existsSync(bookDb)) return out;
  try {
    const Database = await sqlite();
    const db = new Database(bookDb, { readonly: true, fileMustExist: true });
    try {
      const rows = db.prepare('SELECT id, part, page FROM page').all() as Array<{ id: number; part: string | null; page: number | null }>;
      for (const r of rows) out.set(r.id, { volume: r.part ?? null, printedPage: typeof r.page === 'number' ? r.page : null });
    } finally { db.close(); }
  } catch (err) {
    log.warn('page metadata lookup failed', { bookId, message: (err as Error).message });
  }
  return out;
}

/** What a local hit gains from enrichment. All optional — enrichment is best-effort. */
export interface EnrichedFields {
  bookTitle: string;
  author?: string | null;
  deathYear?: number | null;
  volume?: string | null;
  printedPage?: number | null;
  /** The full deterministic reference (shared/citation/shamelaFootnote.ts). */
  citation?: string;
}

/**
 * Fill title, author, death, volume, printed page and the formatted citation
 * on local search hits / page reads. Hits for books whose files are missing
 * are returned unchanged.
 */
export async function enrichLocalHits<T extends { bookId: string; pageNumber: number; bookTitle?: string }>(
  libraryPath: string,
  hits: T[],
): Promise<Array<T & Partial<EnrichedFields>>> {
  const byBook = new Map<string, number[]>();
  for (const h of hits) {
    const list = byBook.get(h.bookId) ?? [];
    list.push(h.pageNumber);
    byBook.set(h.bookId, list);
  }
  const books = new Map<string, BookMeta | null>();
  const pages = new Map<string, Map<number, PageMeta>>();
  for (const [bookId, ids] of byBook) {
    books.set(bookId, await getBookMeta(libraryPath, bookId));
    pages.set(bookId, await getPageMeta(libraryPath, bookId, ids));
  }
  return hits.map((h) => {
    const b = books.get(h.bookId);
    if (!b) return h;
    const p = pages.get(h.bookId)?.get(h.pageNumber);
    return {
      ...h,
      bookTitle: h.bookTitle || b.title,
      author: b.author,
      deathYear: b.deathYear,
      volume: p?.volume ?? null,
      printedPage: p?.printedPage ?? null,
      citation: formatShamelaReference({
        title: h.bookTitle || b.title,
        author: b.author,
        deathYear: b.deathYear,
        volume: p?.volume,
        multiVolume: b.multiVolume,
        printedPage: p?.printedPage,
        internalPage: h.pageNumber,
      }),
    };
  });
}

/** Test seam. */
export function _clearPageMetaCache(): void { bookCache.clear(); }
