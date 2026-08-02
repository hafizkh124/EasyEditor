import React, { useState, useEffect, useCallback } from "react";
import {
  FolderTree, User, Clock, ChevronRight, ChevronLeft, Search,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";

/**
 * Phase 4 (SPEC-M6) — Library Browser.
 *
 * Browse the full Shamela catalogue (8,593 books, 3,188 authors, 41
 * categories) by category tree, author, or historical period, then open any
 * book in the reader. Reads straight from master.db via the native bridge —
 * books are opened directly by their Shamela book id, no import required.
 */

type BrowseMode = "categories" | "authors" | "periods";

interface CatalogueBook {
  id: number;
  title: string;
  author: string | null;
  category: string | null;
  deathYear: number | null;
  bookType: number | null;
}

interface CatalogueCategory {
  id: number;
  name: string;
  bookCount: number;
}

interface CatalogueAuthor {
  id: number;
  name: string;
  deathNumber: number | null;
  deathText: string | null;
  bookCount: number;
}

interface CataloguePeriod {
  century: number;
  label: string;
  bookCount: number;
}

interface BrowseTabProps {
  onSelectBook?: (bookId: string) => void;
  onNavigate?: () => void;
}

const BROWSE_LIMIT = 100;

export const BrowseTab: React.FC<BrowseTabProps> = ({ onSelectBook, onNavigate }) => {
  const { direction } = useLanguage();
  const rtl = direction === "rtl";
  const BackIcon = rtl ? ChevronRight : ChevronLeft;

  const [masterDbPath, setMasterDbPath] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(true);
  const [mode, setMode] = useState<BrowseMode>("categories");
  const [error, setError] = useState<string | null>(null);

  // Categories
  const [categories, setCategories] = useState<CatalogueCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);

  // Authors
  const [authors, setAuthors] = useState<CatalogueAuthor[]>([]);
  const [authorsLoading, setAuthorsLoading] = useState(false);
  const [authorQuery, setAuthorQuery] = useState("");

  // Periods
  const [periods, setPeriods] = useState<CataloguePeriod[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(false);

  // Drill-down state: what is currently shown in the books pane
  const [selectedCategory, setSelectedCategory] = useState<CatalogueCategory | null>(null);
  const [selectedAuthor, setSelectedAuthor] = useState<CatalogueAuthor | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<CataloguePeriod | null>(null);

  // Books pane
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
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to detect Shamela.");
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
      setError(err instanceof Error ? err.message : "Failed to load categories.");
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
      })));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load authors.");
    } finally {
      setAuthorsLoading(false);
    }
  }, [masterDbPath]);

  const loadPeriods = useCallback(async () => {
    if (!masterDbPath) return;
    setPeriodsLoading(true);
    try {
      const api = window.electronAPI!.shamela;
      const rows = await api.periods(masterDbPath);
      setPeriods(rows);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load periods.");
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
      const rows = await fn();
      setBooks(rows);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load books.");
    } finally {
      setBooksLoading(false);
    }
  }, []);

  const openCategory = (cat: CatalogueCategory) => {
    setSelectedCategory(cat);
    setSelectedAuthor(null);
    setSelectedPeriod(null);
    setBooks([]);
    loadBooks(async () => {
      const api = window.electronAPI!.shamela;
      const rows = await api.booksByCategory(masterDbPath!, cat.id, BROWSE_LIMIT);
      return rows;
    });
  };

  const openAuthor = (author: CatalogueAuthor) => {
    setSelectedAuthor(author);
    setSelectedCategory(null);
    setSelectedPeriod(null);
    setBooks([]);
    loadBooks(async () => {
      const api = window.electronAPI!.shamela;
      const rows = await api.booksByAuthor(masterDbPath!, author.id, BROWSE_LIMIT);
      return rows;
    });
  };

  const openPeriod = (period: CataloguePeriod) => {
    setSelectedPeriod(period);
    setSelectedCategory(null);
    setSelectedAuthor(null);
    setBooks([]);
    loadBooks(async () => {
      const api = window.electronAPI!.shamela;
      const rows = await api.booksByPeriod(masterDbPath!, period.century, BROWSE_LIMIT);
      return rows;
    });
  };

  const handleSelectBook = (book: CatalogueBook) => {
    onNavigate?.();
    onSelectBook?.(String(book.id));
  };

  const goBackToBrowse = () => {
    setSelectedCategory(null);
    setSelectedAuthor(null);
    setSelectedPeriod(null);
    setBooks([]);
  };

  // ── View: drilling into a category/author/period's book list ────────────
  if (selectedCategory || selectedAuthor || selectedPeriod) {
    const heading = selectedCategory?.name ?? selectedAuthor?.name ?? selectedPeriod?.label ?? "";
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={goBackToBrowse} title="Back to browse">
            <BackIcon className="h-4 w-4" />
          </Button>
          <p className="text-xs font-semibold truncate flex-1">{heading}</p>
          {books.length > 0 && (
            <span className="text-[10px] text-muted-foreground">{books.length} books</span>
          )}
        </div>
        <ScrollArea className="flex-1 min-h-0">
          {booksLoading ? (
            <p className="p-3 text-xs text-muted-foreground">Loading books…</p>
          ) : books.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">No books found.</p>
          ) : (
            <ul className="py-1">
              {books.map((book) => (
                <li key={book.id}>
                  <button
                    type="button"
                    onClick={() => handleSelectBook(book)}
                    className="w-full text-right flex flex-col gap-0.5 px-3 py-2 border-b border-border/40 hover:bg-accent hover:text-accent-foreground transition-colors"
                  >
                    <span className="text-xs font-medium leading-snug line-clamp-2">{book.title}</span>
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      {book.author && (
                        <>
                          <User className="h-3 w-3" />
                          {book.author}
                        </>
                      )}
                      {book.deathYear != null && book.deathYear < 99999 && (
                        <span className="tabular-nums">· {book.deathYear} هـ</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </div>
    );
  }

  // ── View: browse landing (categories / authors / periods) ──────────────
  return (
    <div className="flex flex-col h-full">
      <div className="px-2 pt-2 pb-1.5 border-b border-border">
        <div className="grid grid-cols-3 gap-1 rounded-md bg-muted/50 p-0.5">
          {([
            { id: "categories" as const, label: "Categories", icon: FolderTree },
            { id: "authors" as const, label: "Authors", icon: User },
            { id: "periods" as const, label: "Periods", icon: Clock },
          ]).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded px-1 py-1 text-[11px] transition-colors",
                mode === id
                  ? "bg-background text-foreground shadow-sm font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3 w-3" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && !masterDbPath && (
        <div className="p-3 text-xs text-destructive">{error}</div>
      )}

      {detecting ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-muted-foreground">Detecting Shamela…</p>
        </div>
      ) : !masterDbPath ? (
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <p className="text-xs text-muted-foreground">
            شاملہ ۴ کا کیٹلاگ دستیاب نہیں ہے۔ انسٹال شدہ شاملہ ۴ کا راستہ سیٹ کریں۔
          </p>
        </div>
      ) : (
        <ScrollArea className="flex-1 min-h-0">
          {mode === "categories" && (
            <div className="p-2 space-y-1">
              {categoriesLoading ? (
                <p className="p-3 text-xs text-muted-foreground">Loading categories…</p>
              ) : (
                categories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => openCategory(cat)}
                    className="w-full flex items-center gap-2 rounded-md px-2 py-2 hover:bg-accent hover:text-accent-foreground transition-colors"
                  >
                    <span className="rounded-md bg-primary/10 p-1.5">
                      <FolderTree className="h-3.5 w-3.5 text-primary" />
                    </span>
                    <span className="flex-1 min-w-0 text-right">
                      <span className="block text-xs font-medium truncate">{cat.name}</span>
                      <span className="block text-[10px] text-muted-foreground">
                        {cat.bookCount.toLocaleString()} books
                      </span>
                    </span>
                    <BackIcon className="h-3.5 w-3.5 text-muted-foreground rotate-180 rtl:rotate-0" />
                  </button>
                ))
              )}
            </div>
          )}

          {mode === "authors" && (
            <div className="p-2 space-y-2">
              <div className="relative">
                <Search className="absolute end-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={authorQuery}
                  onChange={(e) => {
                    setAuthorQuery(e.target.value);
                    loadAuthors(e.target.value);
                  }}
                  placeholder="Search authors…"
                  className="h-8 text-xs pe-8"
                />
              </div>
              {authorsLoading ? (
                <p className="p-3 text-xs text-muted-foreground">Loading authors…</p>
              ) : authors.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">No authors found.</p>
              ) : (
                authors.map((author) => (
                  <button
                    key={author.id}
                    type="button"
                    onClick={() => openAuthor(author)}
                    className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent hover:text-accent-foreground transition-colors"
                  >
                    <span className="rounded-md bg-primary/10 p-1.5 shrink-0">
                      <User className="h-3.5 w-3.5 text-primary" />
                    </span>
                    <span className="flex-1 min-w-0 text-right">
                      <span className="block text-xs font-medium truncate">{author.name}</span>
                      <span className="block text-[10px] text-muted-foreground">
                        {author.deathNumber != null && author.deathNumber < 99999
                          ? `ت  ${author.deathNumber} هـ · `
                          : ""}
                        {author.bookCount} book{author.bookCount === 1 ? "" : "s"}
                      </span>
                    </span>
                    <BackIcon className="h-3.5 w-3.5 text-muted-foreground rotate-180 rtl:rotate-0" />
                  </button>
                ))
              )}
            </div>
          )}

          {mode === "periods" && (
            <div className="p-2 space-y-1">
              {periodsLoading ? (
                <p className="p-3 text-xs text-muted-foreground">Loading periods…</p>
              ) : (
                periods.map((period) => (
                  <button
                    key={period.century}
                    type="button"
                    onClick={() => openPeriod(period)}
                    className="w-full flex items-center gap-2 rounded-md px-2 py-2 hover:bg-accent hover:text-accent-foreground transition-colors"
                  >
                    <span className="rounded-md bg-primary/10 p-1.5">
                      <Clock className="h-3.5 w-3.5 text-primary" />
                    </span>
                    <span className="flex-1 min-w-0 text-right">
                      <span className="block text-xs font-medium truncate">{period.label}</span>
                      <span className="block text-[10px] text-muted-foreground">
                        {period.bookCount.toLocaleString()} books
                      </span>
                    </span>
                    <BackIcon className="h-3.5 w-3.5 text-muted-foreground rotate-180 rtl:rotate-0" />
                  </button>
                ))
              )}
            </div>
          )}
        </ScrollArea>
      )}
    </div>
  );
};
