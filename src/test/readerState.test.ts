// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDatabaseSchema } from '../../electron/db/schema.js';
import {
  saveReadingProgress,
  getReadingProgress,
  listReadingProgress,
  addBookmark,
  removeBookmark,
  isBookmarked,
  listBookmarks,
  addFavorite,
  removeFavorite,
  isFavorite,
  listFavorites,
} from '../../electron/db/workspaceStore/readerState.js';

/**
 * SPEC-M6 Phase 8 — reading progress, bookmarks, favorites.
 *
 * Runs the REAL schema on an in-memory database, so the table definitions in
 * schema.ts are exercised, then drives the store module end-to-end.
 */

let db: Database.Database;

beforeAll(() => {
  db = new Database(':memory:');
  initializeDatabaseSchema(db);
});

describe('reading progress', () => {
  it('returns null before anything is saved', () => {
    expect(getReadingProgress(db, '1001')).toBeNull();
  });

  it('saves and reads back progress', () => {
    saveReadingProgress(db, '1001', 42, 300);
    const progress = getReadingProgress(db, '1001');
    expect(progress).not.toBeNull();
    expect(progress?.bookId).toBe('1001');
    expect(progress?.pageNumber).toBe(42);
    expect(progress?.pageCount).toBe(300);
    expect(typeof progress?.updatedAt).toBe('string');
  });

  it('upserts on conflict (same book, later page)', () => {
    saveReadingProgress(db, '1001', 87, 300);
    const progress = getReadingProgress(db, '1001');
    expect(progress?.pageNumber).toBe(87);
  });

  it('keeps books independent', () => {
    saveReadingProgress(db, '2002', 5, 100);
    const a = getReadingProgress(db, '1001');
    const b = getReadingProgress(db, '2002');
    expect(a?.pageNumber).toBe(87);
    expect(b?.pageNumber).toBe(5);
  });

  it('lists newest-first', () => {
    const list = listReadingProgress(db, 20);
    expect(list.length).toBe(2);
    expect(list[0].bookId).toBe('2002'); // saved last
  });
});

describe('bookmarks', () => {
  it('adds and lists a bookmark', () => {
    const bm = addBookmark(db, '1001', 42);
    expect(bm.bookId).toBe('1001');
    expect(bm.pageNumber).toBe(42);
    expect(isBookmarked(db, '1001', 42)).toBe(true);
    const marks = listBookmarks(db, '1001');
    expect(marks.length).toBe(1);
    expect(marks[0].pageNumber).toBe(42);
  });

  it('keeps the note', () => {
    addBookmark(db, '1001', 12, 'مهم');
    expect(listBookmarks(db, '1001').find((m) => m.pageNumber === 12)?.note).toBe('مهم');
  });

  it('is per-page', () => {
    expect(isBookmarked(db, '1001', 999)).toBe(false);
    expect(isBookmarked(db, '2002', 42)).toBe(false);
  });

  it('removes a bookmark', () => {
    expect(removeBookmark(db, '1001', 12)).toBe(true);
    expect(isBookmarked(db, '1001', 12)).toBe(false);
    expect(removeBookmark(db, '1001', 12)).toBe(false); // already gone
  });
});

describe('favorites', () => {
  it('adds and lists favorites with metadata', () => {
    const fav = addFavorite(db, '1001', 'ذخائر العقبى في مناقب ذوي القربى', 'ابن طولون');
    expect(fav.title).toContain('العقبى');
    expect(isFavorite(db, '1001')).toBe(true);
    const list = listFavorites(db);
    expect(list.length).toBe(1);
    expect(list[0].author).toBe('ابن طولون');
  });

  it('adds a second favorite newest-first', () => {
    addFavorite(db, '2002', 'كتاب ثان');
    const list = listFavorites(db);
    expect(list.length).toBe(2);
    expect(list[0].bookId).toBe('2002');
  });

  it('removes a favorite', () => {
    expect(removeFavorite(db, '2002')).toBe(true);
    expect(isFavorite(db, '2002')).toBe(false);
    expect(removeFavorite(db, '2002')).toBe(false);
  });
});
