import type { SqliteDatabase } from '../open.js';
import { getCurrentUserId, genId } from './identity.js';

/**
 * SPEC-M6 Phase 8 (Favorites & Progress): reading progress, bookmarks, and
 * favorites for the Shamela reader. Keyed by the numeric Shamela book id
 * rather than a library_items row, so a book opened straight from the
 * catalogue (never imported) still gets progress/bookmarks/favorites.
 */

export interface ReadingProgress {
  bookId: string;
  pageNumber: number;
  pageCount: number;
  updatedAt: string;
}

export interface ReaderBookmark {
  id: string;
  bookId: string;
  pageNumber: number;
  note: string | null;
  createdAt: string;
}

export interface ReaderFavorite {
  bookId: string;
  title: string;
  author: string | null;
  createdAt: string;
}

// ── Reading progress ────────────────────────────────────────────────────────

export function saveReadingProgress(
  db: SqliteDatabase,
  bookId: string,
  pageNumber: number,
  pageCount: number,
): void {
  const userId = getCurrentUserId(db);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO reading_progress (book_id, user_id, page_number, page_count, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (book_id) DO UPDATE SET
      page_number = excluded.page_number,
      page_count = excluded.page_count,
      updated_at = excluded.updated_at
  `).run(bookId, userId, pageNumber, pageCount, now);
}

export function getReadingProgress(db: SqliteDatabase, bookId: string): ReadingProgress | null {
  const userId = getCurrentUserId(db);
  const row = db.prepare(
    'SELECT book_id, page_number, page_count, updated_at FROM reading_progress WHERE book_id = ? AND user_id = ?',
  ).get(bookId, userId) as
    | { book_id: string; page_number: number; page_count: number; updated_at: string }
    | undefined;
  if (!row) return null;
  return {
    bookId: row.book_id,
    pageNumber: row.page_number,
    pageCount: row.page_count,
    updatedAt: row.updated_at,
  };
}

/**
 * Books with saved progress, newest first. Used by the reader's "continue
 * reading" resume list and the Favorites tab's progress column.
 */
export function listReadingProgress(db: SqliteDatabase, limit = 20): ReadingProgress[] {
  const userId = getCurrentUserId(db);
  const rows = db.prepare(
    `SELECT book_id, page_number, page_count, updated_at
     FROM reading_progress
     WHERE user_id = ?
     ORDER BY updated_at DESC, rowid DESC
     LIMIT ?`,
  ).all(userId, limit) as Array<{
    book_id: string;
    page_number: number;
    page_count: number;
    updated_at: string;
  }>;
  return rows.map((r) => ({
    bookId: r.book_id,
    pageNumber: r.page_number,
    pageCount: r.page_count,
    updatedAt: r.updated_at,
  }));
}

// ── Bookmarks ───────────────────────────────────────────────────────────────

export function addBookmark(
  db: SqliteDatabase,
  bookId: string,
  pageNumber: number,
  note?: string,
): ReaderBookmark {
  const userId = getCurrentUserId(db);
  const id = genId('bm');
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO reader_bookmarks (id, user_id, book_id, page_number, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, book_id, page_number) DO UPDATE SET
      note = excluded.note
  `).run(id, userId, bookId, pageNumber, note ?? null, createdAt);
  return { id, bookId, pageNumber, note: note ?? null, createdAt };
}

export function removeBookmark(db: SqliteDatabase, bookId: string, pageNumber: number): boolean {
  const userId = getCurrentUserId(db);
  const res = db.prepare(
    'DELETE FROM reader_bookmarks WHERE user_id = ? AND book_id = ? AND page_number = ?',
  ).run(userId, bookId, pageNumber);
  return res.changes > 0;
}

export function isBookmarked(db: SqliteDatabase, bookId: string, pageNumber: number): boolean {
  const userId = getCurrentUserId(db);
  const row = db.prepare(
    'SELECT id FROM reader_bookmarks WHERE user_id = ? AND book_id = ? AND page_number = ?',
  ).get(userId, bookId, pageNumber);
  return !!row;
}

export function listBookmarks(db: SqliteDatabase, bookId: string): ReaderBookmark[] {
  const userId = getCurrentUserId(db);
  const rows = db.prepare(
    `SELECT id, book_id, page_number, note, created_at
     FROM reader_bookmarks
     WHERE user_id = ? AND book_id = ?
     ORDER BY page_number ASC`,
  ).all(userId, bookId) as Array<{
    id: string;
    book_id: string;
    page_number: number;
    note: string | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    bookId: r.book_id,
    pageNumber: r.page_number,
    note: r.note,
    createdAt: r.created_at,
  }));
}

// ── Favorites ───────────────────────────────────────────────────────────────

export function addFavorite(
  db: SqliteDatabase,
  bookId: string,
  title: string,
  author?: string,
): ReaderFavorite {
  const userId = getCurrentUserId(db);
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO reader_favorites (book_id, user_id, title, author, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (book_id) DO UPDATE SET
      title = excluded.title,
      author = excluded.author
  `).run(bookId, userId, title, author ?? null, createdAt);
  return { bookId, title, author: author ?? null, createdAt };
}

export function removeFavorite(db: SqliteDatabase, bookId: string): boolean {
  const userId = getCurrentUserId(db);
  const res = db.prepare(
    'DELETE FROM reader_favorites WHERE user_id = ? AND book_id = ?',
  ).run(userId, bookId);
  return res.changes > 0;
}

export function isFavorite(db: SqliteDatabase, bookId: string): boolean {
  const userId = getCurrentUserId(db);
  const row = db.prepare(
    'SELECT book_id FROM reader_favorites WHERE user_id = ? AND book_id = ?',
  ).get(userId, bookId);
  return !!row;
}

export function listFavorites(db: SqliteDatabase): ReaderFavorite[] {
  const userId = getCurrentUserId(db);
  const rows = db.prepare(
    `SELECT book_id, title, author, created_at
     FROM reader_favorites
     WHERE user_id = ?
     ORDER BY created_at DESC, rowid DESC`,
  ).all(userId) as Array<{
    book_id: string;
    title: string;
    author: string | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    bookId: r.book_id,
    title: r.title,
    author: r.author,
    createdAt: r.created_at,
  }));
}
