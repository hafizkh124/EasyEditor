import { useCallback, useEffect, useState } from "react";
import { getShamelaClient } from "@/core/shamela/shamelaClient";
import type {
  CatalogueAuthor,
  CatalogueBook,
  CatalogueCategory,
  CataloguePeriod,
} from "@/core/shamela/shamelaClient";

/**
 * The Shamela catalogue browser's state machine, lifted out of BrowseTab.
 *
 * One flow, seventeen pieces of state: detect the client → list categories,
 * authors or periods for the current mode → drill into one → load its books.
 * Keeping it here leaves BrowseTab as presentation, and lets the flow be
 * exercised without a DOM.
 *
 * Goes through `shamelaClient` (UX-v1 P7) rather than
 * `window.electronAPI.shamela.*` directly, so the same flow now works on the
 * web build once a `tools/shamela-bridge` companion is connected —
 * `masterDbPath` is the client's concern, not this hook's.
 */

export type BrowseMode = "categories" | "authors" | "periods";

export type { CatalogueAuthor, CatalogueBook, CatalogueCategory, CataloguePeriod };

export const BROWSE_LIMIT = 100;

const message = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : fallback;

export function useCatalogueBrowser() {
  const [available, setAvailable] = useState(false);
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
        const result = await getShamelaClient().detect();
        if (cancelled) return;
        if (result.available) {
          setAvailable(true);
          setError(null);
        } else {
          setAvailable(false);
          setError(result.reason || "شاملہ ۴ نصب نہیں ہے۔");
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
    if (!available) return;
    setCategoriesLoading(true);
    try {
      setCategories(await getShamelaClient().listCategories());
    } catch (err: unknown) {
      setError(message(err, "Failed to load categories."));
    } finally {
      setCategoriesLoading(false);
    }
  }, [available]);

  const loadAuthors = useCallback(async (query: string) => {
    if (!available) return;
    setAuthorsLoading(true);
    try {
      const client = getShamelaClient();
      const rows = query.trim()
        ? await client.searchAuthors(query.trim(), BROWSE_LIMIT)
        : await client.authors(BROWSE_LIMIT);
      setAuthors(rows);
    } catch (err: unknown) {
      setError(message(err, "Failed to load authors."));
    } finally {
      setAuthorsLoading(false);
    }
  }, [available]);

  const loadPeriods = useCallback(async () => {
    if (!available) return;
    setPeriodsLoading(true);
    try {
      setPeriods(await getShamelaClient().periods());
    } catch (err: unknown) {
      setError(message(err, "Failed to load periods."));
    } finally {
      setPeriodsLoading(false);
    }
  }, [available]);

  useEffect(() => {
    if (mode === "categories") loadCategories();
    if (mode === "authors") loadAuthors(authorQuery);
    if (mode === "periods") loadPeriods();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, available]);

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
    loadBooks(() => getShamelaClient().booksByCategory(cat.id, BROWSE_LIMIT));
  }, [enterDrilldown, loadBooks]);

  const openAuthor = useCallback((author: CatalogueAuthor) => {
    enterDrilldown();
    setSelectedAuthor(author);
    loadBooks(() => getShamelaClient().booksByAuthor(author.id, BROWSE_LIMIT));
  }, [enterDrilldown, loadBooks]);

  const openPeriod = useCallback((period: CataloguePeriod) => {
    enterDrilldown();
    setSelectedPeriod(period);
    loadBooks(() => getShamelaClient().booksByPeriod(period.century, BROWSE_LIMIT));
  }, [enterDrilldown, loadBooks]);

  const goBackToBrowse = useCallback(() => {
    enterDrilldown();
  }, [enterDrilldown]);

  const changeAuthorQuery = useCallback((query: string) => {
    setAuthorQuery(query);
    loadAuthors(query);
  }, [loadAuthors]);

  return {
    available, detecting, error,
    mode, setMode,
    categories, categoriesLoading,
    authors, authorsLoading, authorQuery, changeAuthorQuery,
    periods, periodsLoading,
    selectedCategory, selectedAuthor, selectedPeriod,
    books, booksLoading,
    openCategory, openAuthor, openPeriod, goBackToBrowse,
  };
}
