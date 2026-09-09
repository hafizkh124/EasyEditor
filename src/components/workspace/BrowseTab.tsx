import React, { useMemo } from "react";
import {
  FolderTree, User, Clock, ChevronRight, ChevronLeft, Search, CalendarDays, BookMarked, BookOpen,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmptyState } from "./EmptyState";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import { BookCover } from "@/components/shamela/BookCover";
import { useCatalogueBrowser } from "./browse/useCatalogueBrowser";
import type { CatalogueBook, CatalogueAuthor } from "./browse/useCatalogueBrowser";

/**
 * Phase 4 (SPEC-M6) — Library Browser.
 *
 * Browse the full Shamela catalogue (8,593 books, 3,188 authors, 41
 * categories) by category tree, author, or historical period, then open any
 * book in the reader. Reads straight from master.db via the native bridge —
 * books are opened directly by their Shamela book id, no import required.
 *
 * Phase 10 (SPEC-M6) — Authors get a rich detail view (death text, alpha
 * letter badge, work count, covers) and the list is grouped by Arabic letter.
 */

interface BrowseTabProps {
  onSelectBook?: (bookId: string) => void;
  onNavigate?: () => void;
}

// Shamela groups authors by the Arabic alphabet; master.db's `alpha` column is
// the 1-based letter index. Used to show letter badges and group the list.
const ALPHA_LETTERS = "ابتثجحخدذرزسشصضطظعغفقكلمنهوي";

const alphaLetter = (alpha: number | null): string | null =>
  alpha != null && alpha >= 1 && alpha <= ALPHA_LETTERS.length
    ? ALPHA_LETTERS[alpha - 1]
    : null;

export const BrowseTab: React.FC<BrowseTabProps> = ({ onSelectBook, onNavigate }) => {
  const { t, direction } = useLanguage();
  const rtl = direction === "rtl";
  const BackIcon = rtl ? ChevronRight : ChevronLeft;

  const {
    available, detecting, error,
    mode, setMode,
    categories, categoriesLoading,
    authors, authorsLoading, authorQuery, changeAuthorQuery,
    periods, periodsLoading,
    selectedCategory, selectedAuthor, selectedPeriod,
    books, booksLoading,
    openCategory, openAuthor, openPeriod, goBackToBrowse,
    catalogueQuery, setCatalogueQuery, catalogueResults, catalogueSearching, clearCatalogueSearch,
  } = useCatalogueBrowser();

  const handleSelectBook = (book: CatalogueBook) => {
    onNavigate?.();
    onSelectBook?.(String(book.id));
  };

  const searching = catalogueQuery.trim().length >= 2;

  // ── View: drilling into a category/author/period's book list ────────────
  if (selectedCategory || selectedAuthor || selectedPeriod) {
    const heading = selectedCategory?.name ?? selectedAuthor?.name ?? selectedPeriod?.label ?? "";
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border">
          <Button variant="ghost" size="icon" className="h-7 w-7 min-h-touch min-w-touch md:h-7 md:w-7 md:min-h-0 md:min-w-0" onClick={goBackToBrowse} title={t("library.back_to_browse", "Back to browse")}>
            <BackIcon className="h-4 w-4" />
          </Button>
          <p className="text-xs font-semibold truncate flex-1">{heading}</p>
          {books.length > 0 && (
            <span className="text-xs text-muted-foreground">{t("library.book_count", "{count} books").replace("{count}", String(books.length))}</span>
          )}
        </div>

        {/* Phase 10: rich author header — death text, alpha letter, work count. */}
        {selectedAuthor && (
          <div className="px-3 py-2.5 border-b border-border bg-muted/60 flex items-center gap-3">
            <span className="h-10 w-10 rounded-md bg-primary/15 text-primary flex items-center justify-center text-lg font-semibold shrink-0">
              {alphaLetter(selectedAuthor.alpha) ?? "؟"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate leading-tight">{selectedAuthor.name}</p>
              <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {selectedAuthor.deathNumber != null && selectedAuthor.deathNumber < 99999
                    ? t("library.death_ah", "d. {year} AH").replace("{year}", String(selectedAuthor.deathNumber))
                    : t("library.death_unknown", "Death date unknown")}
                </span>
                <span className="flex items-center gap-1">
                  <BookMarked className="h-3.5 w-3.5" />
                  {t("library.author_book_count", "{count} book(s)").replace("{count}", String(selectedAuthor.bookCount))}
                </span>
              </div>
            </div>
          </div>
        )}

        <ScrollArea className="flex-1 min-h-0">
          {booksLoading ? (
            <p className="p-3 text-xs text-muted-foreground">{t("library.loading_books", "Loading books…")}</p>
          ) : error ? (
            /* `error` is otherwise only rendered when the bridge is missing, so
               a catalogue read that failed here reported "No books found." — a
               user cannot tell an empty category from a locked database. */
            <p className="p-3 text-xs text-destructive">{error}</p>
          ) : books.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title={t("library.no_books", "No books found.")}
              description={t("library.no_books_hint", "Try another category, author, or period.")}
            />
          ) : (
            <div className="p-2 grid grid-cols-3 gap-2">
              {books.map((book) => (
                <button
                  key={book.id}
                  type="button"
                  onClick={() => handleSelectBook(book)}
                  className="group text-start flex flex-col gap-1.5 rounded-md border border-border/40 p-1.5 hover:bg-accent hover:text-accent-foreground hover:border-accent-foreground/20 transition-colors"
                >
                  <BookCover bookId={book.id} title={book.title} author={book.author} />
                  <div className="min-w-0 px-0.5">
                    <p className="text-xs font-medium leading-snug line-clamp-2">{book.title}</p>
                    {book.deathYear != null && book.deathYear < 99999 && (
                      <p className="text-xs text-muted-foreground tabular-nums">{t("library.death_ah", "d. {year} AH").replace("{year}", String(book.deathYear))}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    );
  }

  // ── View: browse landing (categories / authors / periods) ──────────────
  return (
    <div className="flex flex-col h-full">
      {/* Universal catalogue search — book title / author / category name. */}
      {available && (
        <div className="p-2 border-b border-border">
          <div className="relative">
            <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={catalogueQuery}
              onChange={(e) => setCatalogueQuery(e.target.value)}
              placeholder={t("library.catalogue_search_placeholder", "کتاب، مصنف یا کیٹگری کا نام…")}
              className="h-8 text-xs ps-8 pe-8"
            />
            {catalogueQuery && (
              <button
                type="button"
                onClick={clearCatalogueSearch}
                aria-label={t("common.clear", "صاف کریں")}
                className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className="h-3.5 w-3.5 rotate-45" />
              </button>
            )}
          </div>
        </div>
      )}

      {searching ? (
        <ScrollArea className="flex-1 min-h-0">
          {catalogueSearching && catalogueResults.books.length + catalogueResults.authors.length + catalogueResults.categories.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">{t("common.searching", "تلاش…")}</p>
          ) : catalogueResults.books.length + catalogueResults.authors.length + catalogueResults.categories.length === 0 ? (
            <EmptyState icon={Search} title={t("library.no_results_title", "کوئی نتیجہ نہیں")} description={t("library.catalogue_no_results", "کوئی کتاب، مصنف یا کیٹگری اس نام سے نہیں ملی۔")} />
          ) : (
            <div className="p-2 space-y-3">
              {catalogueResults.categories.length > 0 && (
                <ResultGroup label={t("library.categories_tab", "کیٹگریز")}>
                  {catalogueResults.categories.map((c) => (
                    <ResultRow key={`c-${c.id}`} icon={FolderTree} title={c.name}
                      subtitle={t("library.book_count", "{count} books").replace("{count}", c.bookCount.toLocaleString())}
                      onClick={() => { clearCatalogueSearch(); openCategory(c); }} />
                  ))}
                </ResultGroup>
              )}
              {catalogueResults.authors.length > 0 && (
                <ResultGroup label={t("library.authors_tab", "مصنفین")}>
                  {catalogueResults.authors.map((a) => (
                    <ResultRow key={`a-${a.id}`} icon={User} title={a.name}
                      subtitle={t("library.author_book_count", "{count} book(s)").replace("{count}", String(a.bookCount))}
                      onClick={() => { clearCatalogueSearch(); openAuthor(a); }} />
                  ))}
                </ResultGroup>
              )}
              {catalogueResults.books.length > 0 && (
                <ResultGroup label={t("library.tab_docs", "کتب")}>
                  {catalogueResults.books.map((b) => (
                    <ResultRow key={`b-${b.id}`} icon={BookOpen} title={b.title}
                      subtitle={[b.author, b.deathYear != null && b.deathYear < 99999 ? t("library.death_ah", "d. {year} AH").replace("{year}", String(b.deathYear)) : null].filter(Boolean).join(" · ")}
                      onClick={() => handleSelectBook(b)} />
                  ))}
                </ResultGroup>
              )}
            </div>
          )}
        </ScrollArea>
      ) : (
      <>
      <div className="px-2 pt-2 pb-1.5 border-b border-border">
        <div className="grid grid-cols-3 gap-1 rounded-md bg-muted p-0.5">
          {([
            { id: "categories" as const, label: t("library.categories_tab", "Categories"), icon: FolderTree },
            { id: "authors" as const, label: t("library.authors_tab", "Authors"), icon: User },
            { id: "periods" as const, label: t("library.periods_tab", "Periods"), icon: Clock },
          ]).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded px-1 py-1 text-xs transition-colors",
                mode === id
                  ? "bg-background text-foreground shadow-sm font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && !available && (
        <div className="p-3 text-xs text-destructive">{error}</div>
      )}

      {detecting ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-muted-foreground">{t("library.detecting_shamela", "Detecting Shamela…")}</p>
        </div>
      ) : !available ? (
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <p className="text-xs text-muted-foreground">
            {t("library.no_shamela", "The Shamela 4 catalogue is not available. Set the path to your installed Shamela 4.")}
          </p>
        </div>
      ) : (
        <ScrollArea className="flex-1 min-h-0">
          {mode === "categories" && (
            <div className="p-2 space-y-1">
              {categoriesLoading ? (
                <p className="p-3 text-xs text-muted-foreground">{t("library.loading_categories", "Loading categories…")}</p>
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
                    <span className="flex-1 min-w-0 text-start">
                      <span className="block text-xs font-medium truncate">{cat.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t("library.book_count", "{count} books").replace("{count}", cat.bookCount.toLocaleString())}
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
                  onChange={(e) => changeAuthorQuery(e.target.value)}
                  placeholder={t("library.search_authors", "Search authors…")}
                  className="h-8 text-xs pe-8"
                />
              </div>
              {authorsLoading ? (
                <p className="p-3 text-xs text-muted-foreground">{t("library.loading_authors", "Loading authors…")}</p>
              ) : authors.length === 0 ? (
                <EmptyState
                  icon={User}
                  title={t("library.no_authors", "No authors found.")}
                  description={t("library.no_authors_hint", "Try another letter or search term.")}
                />
              ) : (
                <AuthorList authors={authors} flat={authorQuery.trim().length > 0} onOpen={openAuthor} />
              )}
            </div>
          )}

          {mode === "periods" && (
            <div className="p-2 space-y-1">
              {periodsLoading ? (
                <p className="p-3 text-xs text-muted-foreground">{t("library.loading_periods", "Loading periods…")}</p>
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
                    <span className="flex-1 min-w-0 text-start">
                      <span className="block text-xs font-medium truncate">{period.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t("library.book_count", "{count} books").replace("{count}", period.bookCount.toLocaleString())}
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
      </>
      )}
    </div>
  );
};

const ResultGroup: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <p className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">{label}</p>
    <div className="space-y-0.5">{children}</div>
  </div>
);

const ResultRow: React.FC<{ icon: React.ComponentType<{ className?: string }>; title: string; subtitle?: string; onClick: () => void }> = ({ icon: Icon, title, subtitle, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-start hover:bg-accent hover:text-accent-foreground transition-colors"
  >
    <span className="rounded-md bg-primary/10 p-1.5 shrink-0"><Icon className="h-3.5 w-3.5 text-primary" /></span>
    <span className="flex-1 min-w-0">
      <span className="block text-xs font-medium truncate">{title}</span>
      {subtitle && <span className="block text-xs text-muted-foreground truncate">{subtitle}</span>}
    </span>
  </button>
);

/**
 * Phase 10 — author list grouped by Arabic letter badge. When searching, the
 * alpha grouping is meaningless (results are filtered arbitrarily), so the
 * flat list is used then.
 */
const AuthorList: React.FC<{
  authors: CatalogueAuthor[];
  flat?: boolean;
  onOpen: (author: CatalogueAuthor) => void;
}> = ({ authors, flat = false, onOpen }) => {
  const { t, direction } = useLanguage();
  const rtl = direction === "rtl";
  const ChevronIcon = rtl ? ChevronLeft : ChevronRight;

  const groups = useMemo(() => {
    const map = new Map<string, CatalogueAuthor[]>();
    for (const a of authors) {
      const letter = flat ? "·" : (alphaLetter(a.alpha) ?? "·");
      const list = map.get(letter) ?? [];
      list.push(a);
      map.set(letter, list);
    }
    return Array.from(map.entries());
  }, [authors, flat]);

  return (
    <div className="space-y-3">
      {groups.map(([letter, list]) => (
        <div key={letter}>
          <p className="px-2 pb-1 text-xs font-semibold uppercase text-muted-foreground/70 flex items-center gap-1.5">
            <span className="h-4 w-4 rounded bg-primary/15 text-primary text-xs flex items-center justify-center">
              {letter}
            </span>
            {t("library.author_count_group", "{count} author(s)").replace("{count}", String(list.length))}
          </p>
          <div className="space-y-0.5">
            {list.map((author) => (
              <button
                key={author.id}
                type="button"
                onClick={() => onOpen(author)}
                className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <span className="rounded-md bg-primary/10 p-1.5 shrink-0">
                  <User className="h-3.5 w-3.5 text-primary" />
                </span>
                <span className="flex-1 min-w-0 text-start">
                  <span className="block text-xs font-medium truncate">{author.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {author.deathNumber != null && author.deathNumber < 99999
                      ? t("library.death_ah", "d. {year} AH").replace("{year}", String(author.deathNumber)) + " · "
                      : ""}
                    {t("library.author_book_count", "{count} book(s)").replace("{count}", String(author.bookCount))}
                  </span>
                </span>
                <ChevronIcon className="h-3.5 w-3.5 text-muted-foreground rotate-180 rtl:rotate-0" />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
