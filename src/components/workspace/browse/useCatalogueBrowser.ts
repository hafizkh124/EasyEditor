import { useCallback, useEffect, useState } from "react";

/**
 * The Shamela catalogue browser's state machine, lifted out of BrowseTab.
 *
 * One flow, seventeen pieces of state: detect the native bridge → list
 * categories, authors or periods for the current mode → drill into one → load
 * its books. Keeping it here leaves BrowseTab as presentation, and lets the
 * flow be exercised without a DOM.
 */

export type BrowseMode = "categories" | "authors" | "periods";

export interface CatalogueBook {
  id: number;
  title: string;
  author: string | null;
  category: string | null;
  deathYear: number | null;
  bookType: number | null;
}

export interface CatalogueCategory {
  id: number;
  name: string;
  bookCount: number;
}

export interface CatalogueAuthor {
  id: number;
  name: string;
  deathNumber: number | null;
  deathText: string | null;
  bookCount: number;
  alpha: number | null;
}

export interface CataloguePeriod {
  century: number;
  label: string;
  bookCount: number;
}

export const BROWSE_LIMIT = 100;

const message = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : fallback;

export function useCatalogueBrowser() {
  const [masterDbPath, setMasterDbPath] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(true);
  const [mode, setMode] = useState<BrowseMode>("categories");
  const [error, setError] = useState<string | null>(null);

  const [categories, setCategories] = useState<CatalogueCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);

  const [authors, setAuthors] = useState<CatalogueAuthor[]>([]);
  const [authorsLoading, setAuthorsLoading] = useState(false);
  const [authorQuery, setAuthorQuery] = useState("");

  const [periods, setPeriods] = useState<CataloguePeriod[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(false);

  // Drill-down state: what is currently shown in the books pane
  const [selectedCategory, setSelectedCategory] = useState<CatalogueCategory | null>(null);
  const [selectedAuthor, setSelectedAuthor] = useState<CatalogueAuthor | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<CataloguePeriod | null>(null);

  const [books, setBooks] = useState<CatalogueBook[]>([]);
  const [booksLoading, setBooksLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const detect = async () => {
      setDetecting(true);
      try {
        const api = window.electronAPI?.shamela;
        if (!api) {
          setError("Native Shamela bridge is unavailable.");
          return;
        }
        const state = await api.detect();
        if (cancelled) return;
        if (state?.installed && state.masterDbPath) {
          setMasterDbPath(state.masterDbPath);
          setError(null);
        } else {
          setMasterDbPath(null);
          setError("شاملہ ۴ نصب نہیں ہے۔");
        }
      } catch (err: unknown) {
        if (!cancelled) setError(message(err, "Failed to detect Shamela."));
      } finally {
        if (!cancelled) setDetecting(false);
      }
    };
    detect();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadCategories = useCallback(async () => {
    if (!masterDbPath) return;
    setCategoriesLoading(true);
    try {
      const api = window.electronAPI!.shamela;
      const cats = await api.listCategories(masterDbPath);
      setCategories(cats.map((c) => ({ id: c.id, name: c.name, bookCount: c.bookCount })));
    } catch (err: unknown) {
      setError(message(err, "Failed to load categories."));
    } finally {
      setCategoriesLoading(false);
    }
  }, [masterDbPath]);

  const loadAuthors = useCallback(async (query: string) => {
    if (!masterDbPath) return;
    setAuthorsLoading(true);
    try {
      const api = window.electronAPI!.shamela;
      const rows = query.trim()
        ? await api.searchAuthors(masterDbPath, query.trim(), BROWSE_LIMIT)
        : await api.authors(masterDbPath, BROWSE_LIMIT);
      setAuthors(rows.map((a) => ({
        id: a.id,
        name: a.name,
        deathNumber: a.deathNumber,
        deathText: a.deathText,
        bookCount: a.bookCount,
        alpha: a.alpha,
      })));
    } catch (err: unknown) {
      setError(message(err, "Failed to load authors."));
    } finally {
      setAuthorsLoading(false);
    }
  }, [masterDbPath]);

  const loadPeriods = useCallback(async () => {
    if (!masterDbPath) return;
    setPeriodsLoading(true);
    try {
      const api = window.electronAPI!.shamela;
      setPeriods(await api.periods(masterDbPath));
    } catch (err: unknown) {
      setError(message(err, "Failed to load periods."));
    } finally {
      setPeriodsLoading(false);
    }
  }, [masterDbPath]);

  useEffect(() => {
    if (mode === "categories") loadCategories();
    if (mode === "authors") loadAuthors(authorQuery);
    if (mode === "periods") loadPeriods();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, masterDbPath]);

  const loadBooks = useCallback(async (fn: () => Promise<CatalogueBook[]>) => {
    setBooksLoading(true);
    try {
      setBooks(await fn());
    } catch (err: unknown) {
      setError(message(err, "Failed to load books."));
    } finally {
      setBooksLoading(false);
    }
  }, []);

  /** Entering any drill-down clears the other two, so only one can be active. */
  const enterDrilldown = useCallback(() => {
    setSelectedCategory(null);
    setSelectedAuthor(null);
    setSelectedPeriod(null);
    setBooks([]);
    setError(null);
  }, []);

  const openCategory = useCallback((cat: CatalogueCategory) => {
    enterDrilldown();
    setSelectedCategory(cat);
    loadBooks(() => window.electronAPI!.shamela.booksByCategory(masterDbPath!, cat.id, BROWSE_LIMIT));
  }, [enterDrilldown, loadBooks, masterDbPath]);

  const openAuthor = useCallback((author: CatalogueAuthor) => {
    enterDrilldown();
    setSelectedAuthor(author);
    loadBooks(() => window.electronAPI!.shamela.booksByAuthor(masterDbPath!, author.id, BROWSE_LIMIT));
  }, [enterDrilldown, loadBooks, masterDbPath]);

  const openPeriod = useCallback((period: CataloguePeriod) => {
    enterDrilldown();
    setSelectedPeriod(period);
    loadBooks(() => window.electronAPI!.shamela.booksByPeriod(masterDbPath!, period.century, BROWSE_LIMIT));
  }, [enterDrilldown, loadBooks, masterDbPath]);

  const goBackToBrowse = useCallback(() => {
    enterDrilldown();
  }, [enterDrilldown]);

  const changeAuthorQuery = useCallback((query: string) => {
    setAuthorQuery(query);
    loadAuthors(query);
  }, [loadAuthors]);

  return {
    masterDbPath, detecting, error,
    mode, setMode,
    categories, categoriesLoading,
    authors, authorsLoading, authorQuery, changeAuthorQuery,
    periods, periodsLoading,
    selectedCategory, selectedAuthor, selectedPeriod,
    books, booksLoading,
    openCategory, openAuthor, openPeriod, goBackToBrowse,
  };
}
