/**
 * Cloud implementation of the reader-state backend (SPEC-M6 Phase 8).
 *
 * The Shamela reader is a desktop-only feature — it needs the native bridge
 * (electronAPI.shamela) and the local SQLite file. The cloud runtime therefore
 * exposes the same surface but as a no-op stub, so the ~reader UI never needs
 * to know which backend is live (FR-1.1).
 */
import type {
  ReaderBackend,
  ReadingProgress,
  ReaderBookmark,
  ReaderFavorite,
} from "../types";

export const cloudReading: ReaderBackend = {
  async saveReadingProgress(_bookId: string, _pageNumber: number, _pageCount: number): Promise<void> {
    // Reader is desktop-only; nothing to persist.
  },

  async getReadingProgress(_bookId: string): Promise<ReadingProgress | null> {
    return null;
  },

  async listReadingProgress(_limit = 20): Promise<ReadingProgress[]> {
    return [];
  },

  async addBookmark(_bookId: string, _pageNumber: number, _note?: string): Promise<ReaderBookmark | null> {
    return null;
  },

  async removeBookmark(_bookId: string, _pageNumber: number): Promise<boolean> {
    return false;
  },

  async isBookmarked(_bookId: string, _pageNumber: number): Promise<boolean> {
    return false;
  },

  async listBookmarks(_bookId: string): Promise<ReaderBookmark[]> {
    return [];
  },

  async addFavorite(_bookId: string, _title: string, _author?: string): Promise<ReaderFavorite | null> {
    return null;
  },

  async removeFavorite(_bookId: string): Promise<boolean> {
    return false;
  },

  async isFavorite(_bookId: string): Promise<boolean> {
    return false;
  },

  async listFavorites(): Promise<ReaderFavorite[]> {
    return [];
  },
};
