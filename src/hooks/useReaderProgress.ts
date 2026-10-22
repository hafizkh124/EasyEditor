import { useState, useEffect, useCallback, useRef } from "react";
import { readerService } from "@/core/workspace/readerService";
import type { ReadingProgress, ReaderBookmark } from "@/core/backend/types";
import { logger } from "@/lib/logger";

const log = logger.child("useReaderProgress");

/**
 * SPEC-M6 Phase 8 (Favorites & Progress): reader-side state for reading
 * progress, bookmarks, and favorites, keyed by the Shamela book id.
 *
 * - Reading progress is saved trailing-debounced so a fast page-flip (or a
 *   resume jump shortly after opening) never commits a transient page number,
 *   and the last pending page is flushed on unmount.
 * - `bookmarked` reflects whether the CURRENT page has a bookmark, so it is
 *   re-checked whenever the page changes.
 */
export function useReaderProgress(
  bookId: string | null,
  title: string,
  author?: string,
  currentPage?: number,
) {
  const [progress, setProgress] = useState<ReadingProgress | null>(null);
  const [bookmarked, setBookmarked] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [bookmarks, setBookmarks] = useState<ReaderBookmark[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Latest pending save (so the trailing debounce can be flushed on unmount).
  const pendingRef = useRef<{ bookId: string; page: number; count: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Per-book state (progress, favorite flag, bookmark list) — refetched only
  // when the book changes.
  const refresh = useCallback(async (id: string) => {
    try {
      const [p, favNow, marks] = await Promise.all([
        readerService.getReadingProgress(id),
        readerService.isFavorite(id),
        readerService.listBookmarks(id),
      ]);
      setProgress(p);
      setIsFavorite(favNow);
      setBookmarks(marks);
    } catch {
      // Reader state is best-effort; never block reading on it.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!bookId) {
      setLoaded(false);
      return;
    }
    setLoaded(false);
    refresh(bookId);
  }, [bookId, refresh]);

  // Whether the CURRENT page is bookmarked — cheap check that must follow page
  // turns without refetching the whole per-book state.
  useEffect(() => {
    if (!bookId || currentPage == null) return;
    readerService
      .isBookmarked(bookId, currentPage)
      .then(setBookmarked)
      .catch(() => {});
  }, [bookId, currentPage]);

  const savePage = useCallback((bookId: string, pageNumber: number, pageCount: number) => {
    pendingRef.current = { bookId, page: pageNumber, count: pageCount };
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (!pending) return;
      readerService.saveReadingProgress(pending.bookId, pending.page, pending.count).catch((err) => log.warn("could not save reading progress", { err }));
    }, 500);
  }, []);

  // Flush the last pending save on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) {
        readerService.saveReadingProgress(pending.bookId, pending.page, pending.count).catch((err) => log.warn("could not save reading progress", { err }));
      }
    };
  }, []);

  const toggleBookmark = useCallback(
    async (pageNumber: number) => {
      if (!bookId) return;
      try {
        const now = await readerService.isBookmarked(bookId, pageNumber);
        if (now) {
          await readerService.removeBookmark(bookId, pageNumber);
          setBookmarked(false);
        } else {
          await readerService.addBookmark(bookId, pageNumber);
          setBookmarked(true);
        }
        const marks = await readerService.listBookmarks(bookId);
        setBookmarks(marks);
      } catch {
        // Best-effort.
      }
    },
    [bookId],
  );

  const toggleFavorite = useCallback(async () => {
    if (!bookId) return;
    try {
      if (isFavorite) {
        await readerService.removeFavorite(bookId);
        setIsFavorite(false);
      } else {
        await readerService.addFavorite(bookId, title, author);
        setIsFavorite(true);
      }
    } catch {
      // Best-effort.
    }
  }, [bookId, title, author, isFavorite]);

  // Whether a specific page is bookmarked, derived from the loaded bookmark
  // list. Callers create this hook before their reader state exists, so they
  // cannot pass `currentPage` in — this lets the toolbar icon follow page
  // turns instead of showing a stale value (and deleting the bookmark the
  // user meant to add).
  const isPageBookmarked = useCallback(
    (page: number) => bookmarks.some((b) => b.pageNumber === page),
    [bookmarks],
  );

  return {
    progress,
    bookmarked,
    isFavorite,
    bookmarks,
    isPageBookmarked,
    loaded,
    savePage,
    toggleBookmark,
    toggleFavorite,
  };
}

