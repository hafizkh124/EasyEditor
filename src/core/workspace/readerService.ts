/**
 * Reader state service (SPEC-M6 Phase 8) — facade over the backend adapter.
 * Implementation: src/core/backend/cloud/reading.ts (cloud) / localBackend.ts (local).
 */
import { backendFacade } from "@/core/backend";
import type { ReadingProgress, ReaderBookmark, ReaderFavorite } from "@/core/backend/types";

export type { ReadingProgress, ReaderBookmark, ReaderFavorite };

const reading = backendFacade("reading");

export const readerService = {
  saveReadingProgress: (bookId: string, pageNumber: number, pageCount: number) =>
    reading.saveReadingProgress(bookId, pageNumber, pageCount),
  getReadingProgress: (bookId: string) => reading.getReadingProgress(bookId),
  listReadingProgress: (limit?: number) => reading.listReadingProgress(limit),
  addBookmark: (bookId: string, pageNumber: number, note?: string) =>
    reading.addBookmark(bookId, pageNumber, note),
  removeBookmark: (bookId: string, pageNumber: number) => reading.removeBookmark(bookId, pageNumber),
  isBookmarked: (bookId: string, pageNumber: number) => reading.isBookmarked(bookId, pageNumber),
  listBookmarks: (bookId: string) => reading.listBookmarks(bookId),
  addFavorite: (bookId: string, title: string, author?: string) =>
    reading.addFavorite(bookId, title, author),
  removeFavorite: (bookId: string) => reading.removeFavorite(bookId),
  isFavorite: (bookId: string) => reading.isFavorite(bookId),
  listFavorites: () => reading.listFavorites(),
};
