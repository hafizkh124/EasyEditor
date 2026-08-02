import { useState, useEffect, useCallback, useRef } from "react";

/**
 * One chapter/heading entry in a Shamela book's table of contents, joined
 * from the Lucene `title` index and the book's own `title` SQLite table.
 */
export interface TocEntry {
  titleId: string;
  text: string;
  page: number;
  parent: string;
  depth: number;
}

/** A single page of book text as the Shamela helper returns it. */
export interface ReaderPage {
  bookId: string;
  pageNumber: number;
  text: string;
  footnotes?: string;
}

interface ReaderState {
  /** `<bookId>-<pageId>` style page key for the currently shown page. */
  currentKey: string | null;
  /** The whole-book page index (1..pageCount) for next/prev bounds. */
  currentPageNumber: number;
  pageCount: number;
  toc: TocEntry[];
  tocLoading: boolean;
  tocError: string | null;
  page: ReaderPage | null;
  pageLoading: boolean;
  pageError: string | null;
  /** Which TOC entry (if any) the current page belongs to. */
  currentTitleId: string | null;
  goToPage: (pageNumber: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  back: () => void;
  forward: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  goToTocEntry: (entry: TocEntry) => void;
  jumpToTitle: (titleId: string) => void;
  reloadToc: () => void;
}

const electronAPI = () => window.electronAPI?.shamela;

export function useReaderState(bookId: string | null): ReaderState {
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [tocLoading, setTocLoading] = useState(false);
  const [tocError, setTocError] = useState<string | null>(null);

  const [pageCount, setPageCount] = useState(0);
  const [currentPageNumber, setCurrentPageNumber] = useState<number>(1);

  const [page, setPage] = useState<ReaderPage | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  // Forward/back history, like a browser. `back()` can only move within the
  // current book (no leaving it), so it is kept here rather than in router.
  const [history, setHistory] = useState<number[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyRef = useRef<{ stack: number[]; index: number }>({ stack: [], index: -1 });

  // Title currently open — derived from the page number via the TOC.
  const [currentTitleId, setCurrentTitleId] = useState<string | null>(null);

  const loadToc = useCallback(async () => {
    if (!bookId) return;
    const api = electronAPI();
    if (!api) {
      setTocError("Native Shamela bridge is unavailable.");
      return;
    }
    setTocLoading(true);
    setTocError(null);
    try {
      const entries = await api.readToc(bookId);
      setToc(entries ?? []);
    } catch (err: unknown) {
      setTocError(err instanceof Error ? err.message : "Failed to load the table of contents.");
    } finally {
      setTocLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    setToc([]);
    setCurrentPageNumber(1);
    setHistory([]);
    setHistoryIndex(-1);
    historyRef.current = { stack: [], index: -1 };
    setCurrentTitleId(null);
    setPage(null);
    setPageCount(0);
    loadedBookRef.current = null;
    loadToc();

    if (!bookId) return;
    const api = electronAPI();
    if (api?.pageCount) {
      api
        .pageCount(bookId)
        .then((n) => setPageCount(n))
        .catch(() => setPageCount(0));
    }
  }, [bookId, loadToc]);

  // Load a page, pushing onto the history stack.
  const loadPage = useCallback(
    async (pageNumber: number, recordHistory: boolean) => {
      if (!bookId) return;
      const api = electronAPI();
      if (!api) {
        setPageError("Native Shamela bridge is unavailable.");
        return;
      }
      const clamped = Math.max(1, Math.min(pageNumber, pageCount || pageNumber));
      if (recordHistory) {
        const stack = [...historyRef.current.stack.slice(0, historyRef.current.index + 1), clamped];
        historyRef.current = { stack, index: stack.length - 1 };
        setHistory(stack);
        setHistoryIndex(stack.length - 1);
      }
      setCurrentPageNumber(clamped);
      setPageLoading(true);
      setPageError(null);
      try {
        const result = await api.readPage(bookId, clamped);
        setPage(result);
      } catch (err: unknown) {
        setPageError(err instanceof Error ? err.message : "Failed to read the page.");
      } finally {
        setPageLoading(false);
      }
    },
    [bookId, pageCount],
  );

  // Initial load of page 1 once the book is set (and after any book switch).
  const loadedBookRef = useRef<string | null>(null);
  useEffect(() => {
    if (!bookId || pageCount <= 0) return;
    if (loadedBookRef.current === bookId) return;
    loadedBookRef.current = bookId;
    loadPage(1, true);
  }, [bookId, pageCount, loadPage]);

  // Derive the active title whenever the page or TOC changes.
  useEffect(() => {
    if (toc.length === 0) {
      setCurrentTitleId(null);
      return;
    }
    let title: string | null = null;
    for (let i = 0; i < toc.length; i += 1) {
      const e = toc[i];
      if (e.page <= currentPageNumber) title = e.titleId;
      else break;
    }
    setCurrentTitleId(title);
  }, [toc, currentPageNumber]);

  const goToPage = useCallback(
    (pageNumber: number) => {
      if (pageNumber >= 1 && pageNumber <= pageCount) loadPage(pageNumber, true);
    },
    [loadPage, pageCount],
  );

  const nextPage = useCallback(() => {
    if (currentPageNumber < pageCount) loadPage(currentPageNumber + 1, true);
  }, [currentPageNumber, pageCount, loadPage]);

  const prevPage = useCallback(() => {
    if (currentPageNumber > 1) loadPage(currentPageNumber - 1, true);
  }, [currentPageNumber, loadPage]);

  const goToTocEntry = useCallback(
    (entry: TocEntry) => {
      if (entry.page >= 1 && entry.page <= pageCount) loadPage(entry.page, true);
    },
    [loadPage, pageCount],
  );

  const back = useCallback(() => {
    const { stack, index } = historyRef.current;
    if (index <= 0) return;
    const target = stack[index - 1];
    historyRef.current = { stack, index: index - 1 };
    setHistoryIndex(index - 1);
    loadPage(target, false);
  }, [loadPage]);

  const forward = useCallback(() => {
    const { stack, index } = historyRef.current;
    if (index >= stack.length - 1) return;
    const target = stack[index + 1];
    historyRef.current = { stack, index: index + 1 };
    setHistoryIndex(index + 1);
    loadPage(target, false);
  }, [loadPage]);

  const jumpToTitle = useCallback(
    (titleId: string) => {
      const entry = toc.find((e) => e.titleId === titleId);
      if (entry) goToTocEntry(entry);
    },
    [toc, goToTocEntry],
  );

  return {
    currentKey: bookId ? `${bookId}-${currentPageNumber}` : null,
    currentPageNumber,
    pageCount,
    toc,
    tocLoading,
    tocError,
    page,
    pageLoading,
    pageError,
    currentTitleId,
    goToPage,
    nextPage,
    prevPage,
    back,
    forward,
    canGoBack: historyIndex > 0,
    canGoForward: historyIndex >= 0 && historyIndex < history.length - 1,
    goToTocEntry,
    jumpToTitle,
    reloadToc: loadToc,
  };
}
