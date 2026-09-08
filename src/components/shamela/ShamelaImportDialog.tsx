import { useState, useEffect, useCallback } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Search, BookOpen, User, Layers, Calendar, Download,
  Loader2
} from "lucide-react";
import { ImportEstimateDialog, type ImportEstimate } from "./ImportEstimateDialog";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatTranslation, translateStored, translateStoredFormat } from "@/lib/i18n";
import { logger } from "@/lib/logger";

const log = logger.child("ShamelaImportDialog");

/** Mirrors electron/shamela/import.ts's ImportProgress. */
interface ImportProgress {
  bookId: number;
  title: string;
  bookIndex: number;
  totalBooks: number;
  pagesRead: number;
  chunksStored: number;
  status: string;
  error?: string;
}

export interface ShamelaBook {
  id: number;
  title: string;
  author: string | null;
  category: string | null;
  deathYear: number | null;
  bookType: number | null;
  info: string | null;
}

export interface ShamelaCategory {
  id: number;
  name: string;
  parentId: number | null;
  bookCount: number;
}

interface ShamelaImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  masterDbPath: string;
  initialTab?: "browse" | "search";
}

export function ShamelaImportDialog({
  open, onOpenChange, masterDbPath, initialTab = "browse",
}: ShamelaImportDialogProps) {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<string>(initialTab);
  const [searchQuery, setSearchQuery] = useState("");
  const [books, setBooks] = useState<ShamelaBook[]>([]);
  const [categories, setCategories] = useState<ShamelaCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedBooks, setSelectedBooks] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [estimateOpen, setEstimateOpen] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState<ImportEstimate | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  /** Books already in the local corpus — importing them again would re-spend (FR-2.6). */
  const [imported, setImported] = useState<Set<number>>(new Set());

  const loadCategories = useCallback(async () => {
    if (!window.electronAPI?.shamela) return;
    try {
      const cats = await window.electronAPI.shamela.listCategories(masterDbPath);
      setCategories(cats);
    } catch (err) {
      log.error("loadCategories error", { err });
    }
  }, [masterDbPath]);

  const searchBooks = useCallback(async (query: string) => {
    if (!window.electronAPI?.shamela || !query.trim()) {
      setBooks([]);
      return;
    }
    setLoading(true);
    try {
      const results = await window.electronAPI.shamela.searchBooks(masterDbPath, query, 100);
      setBooks(results);
    } catch (err) {
      log.error("searchBooks error", { err });
      toast.error(translateStored("toast.shamela.search_failed"));
    } finally {
      setLoading(false);
    }
  }, [masterDbPath]);

  const loadBooksByCategory = useCallback(async (categoryId: number) => {
    if (!window.electronAPI?.shamela) return;
    setLoading(true);
    try {
      const results = await window.electronAPI.shamela.booksByCategory(masterDbPath, categoryId, 100);
      setBooks(results);
    } catch (err) {
      log.error("booksByCategory error", { err });
    } finally {
      setLoading(false);
    }
  }, [masterDbPath]);

  useEffect(() => {
    if (open) {
      loadCategories();
    }
  }, [open, loadCategories]);

  // Live per-book progress from the main process during an import.
  useEffect(() => {
    if (!window.electronAPI?.shamela?.onImportProgress) return;
    return window.electronAPI.shamela.onImportProgress(setProgress);
  }, []);

  // Mark books already imported so the user does not pay for them twice.
  useEffect(() => {
    if (books.length === 0 || !window.electronAPI?.shamela) return;
    let cancelled = false;
    window.electronAPI.shamela
      .alreadyImported(books.map((b) => b.id))
      .then((ids) => { if (!cancelled) setImported(new Set(ids)); })
      .catch(() => { /* the badge is an optimisation, not a gate */ });
    return () => { cancelled = true; };
  }, [books]);

  const handleSearch = () => {
    if (searchQuery.trim()) {
      setSelectedCategory(null);
      searchBooks(searchQuery);
    }
  };

  const handleCategorySelect = (catId: number) => {
    setSelectedCategory(catId);
    setSearchQuery("");
    loadBooksByCategory(catId);
  };

  const toggleBook = (bookId: number) => {
    setSelectedBooks((prev) => {
      const next = new Set(prev);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  };

  /**
   * Step 1 of the import: the mandatory estimate (SPEC-M5 FR-5.4). No text is
   * read and no request leaves the machine until the user confirms the dialog
   * this opens — that gate is the only thing standing between a stray click
   * and a large bill on the user's own Google account (risk R7).
   */
  const handleReviewSelection = async () => {
    if (selectedBooks.size === 0) {
      toast.error(translateStored("toast.shamela.select_book"));
      return;
    }
    if (!window.electronAPI?.shamela) {
      toast.error(translateStored("toast.shamela.desktop_only"));
      return;
    }

    setEstimating(true);
    setEstimateOpen(true);
    try {
      const ids = [...selectedBooks];
      setEstimate(await window.electronAPI.shamela.estimateImport(masterDbPath, ids));
    } catch (err) {
      log.error("estimate error", { err });
      toast.error(err instanceof Error ? err.message : translateStored("toast.shamela.estimate_failed"));
      setEstimateOpen(false);
    } finally {
      setEstimating(false);
    }
  };

  /** Step 2: the user confirmed the cost — now the import may spend. */
  const handleConfirmImport = async () => {
    setEstimateOpen(false);
    setImporting(true);
    setProgress(null);

    try {
      if (!window.electronAPI?.shamela) {
        // Defense-in-depth: handleReviewSelection already blocks this path
        // before the estimate dialog ever opens, but importBooks is a real
        // spend — never reach it on an assumption alone.
        toast.error(translateStored("toast.shamela.desktop_only"));
        return;
      }
      const selected = books
        .filter((b) => selectedBooks.has(b.id))
        .map((b) => ({ id: b.id, title: b.title, author: b.author }));

      const result = await window.electronAPI.shamela.importBooks(selected);

      if (result.cancelled) {
        toast.info(translateStoredFormat("toast.shamela.import_cancelled", { count: result.imported }));
      } else {
        toast.success(translateStoredFormat("toast.shamela.imported_count", { count: result.imported }));
      }

      setImported((prev) => new Set([...prev, ...result.items.map((it) => it.bookId)]));
      setSelectedBooks(new Set());
      if (!result.cancelled) onOpenChange(false);
    } catch (err) {
      log.error("import error", { err });
      toast.error(err instanceof Error ? err.message : translateStored("toast.shamela.import_failed"));
    } finally {
      setImporting(false);
      setProgress(null);
    }
  };

  const handleCancelImport = () => {
    window.electronAPI?.shamela.cancelImport();
  };

  const totalSelected = selectedBooks.size;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <BookOpen className="h-5 w-5 text-primary" />
            {t("shamela.import.title")}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("shamela.import.description")}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid grid-cols-2 w-full sm:w-64">
            <TabsTrigger value="browse" className="gap-1.5 text-xs">
              <Layers className="h-3.5 w-3.5" />
              {t("shamela.categories")}
            </TabsTrigger>
            <TabsTrigger value="search" className="gap-1.5 text-xs">
              <Search className="h-3.5 w-3.5" />
              {t("common.search")}
            </TabsTrigger>
          </TabsList>

          {/* Browse by category. M10 Phase 3: the 256px category column used
              to sit beside the book list unconditionally — on a ~327px-wide
              mobile dialog body that left the book list ~55px wide, in
              practice zero. Stacked below md instead (category picker gets a
              bounded height so the book list below it still gets real room;
              side-by-side, fixed-width sidebar returns at md+). */}
          <TabsContent value="browse" className="flex-1 flex flex-col md:flex-row gap-4 min-h-0 mt-4">
            <div className="w-full md:w-64 shrink-0 flex flex-col gap-1 min-h-0 max-h-40 md:max-h-none">
              <span className="text-xs font-semibold text-muted-foreground px-1">{t("shamela.categories")}</span>
              {/* Was a fixed h-[400px]: on a dialog shorter than header+400px+footer,
                  this list overflowed past its column and slid under DialogFooter,
                  whose Import/Close buttons then lost clicks to the category row
                  now sitting on top at that pixel position (verified via
                  elementFromPoint — SPEC-M9 QA finding). flex-1 min-h-0 makes it
                  size to whatever space the dialog actually has. */}
              <ScrollArea className="flex-1 min-h-0 rounded border border-border">
                {categories.length === 0 ? (
                  <div className="p-4 text-xs text-muted-foreground text-center">
                    {t("shamela.no_categories")}
                  </div>
                ) : (
                  categories.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => handleCategorySelect(cat.id)}
                      className={`w-full text-end px-3 py-2 text-xs flex items-center justify-between gap-2 hover:bg-muted transition-colors ${
                        selectedCategory === cat.id ? "bg-primary/10 text-primary font-medium" : ""
                      }`}
                    >
                      <span className="truncate">{cat.name}</span>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {cat.bookCount}
                      </Badge>
                    </button>
                  ))
                )}
              </ScrollArea>
            </div>

            <div className="flex-1 min-w-0 flex flex-col gap-1 min-h-0">
              <span className="text-xs font-semibold text-muted-foreground px-1 block">
                {selectedCategory
                  ? `کتب — ${categories.find((c) => c.id === selectedCategory)?.name || ""}`
                  : "کتب — زمرہ منتخب کریں"}
              </span>
              <BookList
                books={books}
                loading={loading}
                selectedBooks={selectedBooks}
                onToggle={toggleBook}
                imported={imported}
              />
            </div>
          </TabsContent>

          {/* Search */}
          <TabsContent value="search" className="flex-1 flex flex-col min-h-0 mt-4">
            <div className="flex gap-2 mb-3">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder={t("shamela.search_placeholder")}
                className="text-xs"
              />
              <Button size="sm" onClick={handleSearch} disabled={loading} className="gap-1.5 shrink-0">
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                {t("common.search")}
              </Button>
            </div>
            <div className="flex-1 min-h-0">
              <BookList
                books={books}
                loading={loading}
                selectedBooks={selectedBooks}
                onToggle={toggleBook}
                imported={imported}
              />
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="border-t border-border pt-4 mt-4 flex items-center gap-2">
          <div className="flex-1 text-xs text-muted-foreground">
            {importing && progress
              ? formatTranslation(t("shamela.import.progress"), { current: progress.bookIndex, total: progress.totalBooks, title: progress.title, pages: progress.pagesRead, chunks: progress.chunksStored })
              : totalSelected > 0
              ? `${totalSelected} کتاب(یں) منتخب`
              : "کوئی کتاب منتخب نہیں"}
          </div>

          {importing ? (
            <Button variant="outline" size="sm" onClick={handleCancelImport}>
              {t("shamela.stop_import")}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {t("common.close")}
            </Button>
          )}

          <Button
            size="sm"
            onClick={handleReviewSelection}
            disabled={totalSelected === 0 || importing}
            className="gap-1.5"
          >
            {importing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {importing ? t("shamela.importing") : t("shamela.import_selected")}
          </Button>
        </DialogFooter>
      </DialogContent>

      <ImportEstimateDialog
        open={estimateOpen}
        onOpenChange={setEstimateOpen}
        estimate={estimate}
        loading={estimating}
        onConfirm={handleConfirmImport}
      />
    </Dialog>
  );
}

function BookList({
  books,
  loading,
  selectedBooks,
  onToggle,
  imported,
}: {
  books: ShamelaBook[];
  loading: boolean;
  selectedBooks: Set<number>;
  onToggle: (id: number) => void;
  imported: Set<number>;
}) {
  const { t } = useLanguage();
  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-xs text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin ms-2" />
        {t("shamela.searching")}
      </div>
    );
  }

  if (books.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-xs text-muted-foreground gap-2">
        <BookOpen className="h-8 w-8 text-muted-foreground/40" />
        {t("shamela.no_books")}
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1 min-h-0 rounded border border-border">
      {books.map((book) => (
        <div
          key={book.id}
          onClick={() => onToggle(book.id)}
          className={`flex items-start gap-3 p-3 border-b border-border/50 last:border-0 cursor-pointer transition-colors hover:bg-muted ${
            selectedBooks.has(book.id) ? "bg-primary/5 border-primary/30" : ""
          }`}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">{book.title}</span>
              {imported.has(book.id) && (
                <Badge variant="secondary" className="text-xs shrink-0">{t("shamela.imported")}</Badge>
              )}
              {selectedBooks.has(book.id) && !imported.has(book.id) && (
                <Badge variant="default" className="text-xs shrink-0">{t("common.selected")}</Badge>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              {book.author && (
                <span className="flex items-center gap-1">
                  <User className="h-3.5 w-3.5" />
                  {book.author}
                </span>
              )}
              {book.category && (
                <span className="flex items-center gap-1">
                  <Layers className="h-3.5 w-3.5" />
                  {book.category}
                </span>
              )}
              {book.deathYear != null && book.deathYear < 99999 && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {book.deathYear} {t("shamela.hijri_suffix")}
                </span>
              )}
            </div>
          </div>
          <div className={`w-5 h-5 rounded border-2 shrink-0 mt-0.5 flex items-center justify-center transition-colors ${
            selectedBooks.has(book.id)
              ? "border-primary bg-primary text-primary-foreground"
              : "border-muted-foreground/30"
          }`}>
            {selectedBooks.has(book.id) && (
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
        </div>
      ))}
    </ScrollArea>
  );
}
