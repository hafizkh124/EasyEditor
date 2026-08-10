import React, { useState, useEffect } from "react";
import { ArrowLeftRight, BookOpen, ChevronLeft, ChevronRight, Columns2, Star, Bookmark, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReaderState } from "@/hooks/useReaderState";
import { useReaderSettings } from "@/hooks/useReaderSettings";
import { useReaderProgress } from "@/hooks/useReaderProgress";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import { htmlToPlainText } from "@/lib/reader/htmlToPlainText";
import { Button } from "@/components/ui/button";
import { ReaderSettings } from "./ReaderSettings";
import { ReaderContent } from "./ReaderContent";
import { ReaderBottomBar } from "./ReaderBottomBar";
import { useLanguage } from "@/contexts/LanguageContext";

export interface SplitBook {
  bookId: string;
  title: string;
  author?: string;
}

interface SplitReaderProps {
  primary: SplitBook;
  secondary: SplitBook;
  onClose: () => void;
  /** Collapse back to the single-reader view. */
  onCloseSecondary: () => void;
  /** Swap which book is on which side. */
  onSwap?: () => void;
}

type ReaderSettingsValue = ReturnType<typeof useReaderSettings>;

interface SplitPaneProps {
  book: SplitBook;
  primary?: boolean;
  onClosePane?: () => void;
  readerSettings: ReaderSettingsValue;
}

/**
 * A pane is a self-contained reader with its own page history and progress.
 *
 * It MUST stay declared at module scope. When it lived inside `SplitReader`'s
 * body, every parent render (typography change, swap, or — via
 * `setReaderPage` → WorkspaceContext → WorkspaceLayout — every page turn)
 * produced a fresh component identity, so React unmounted and remounted both
 * panes: page reset to 1, scroll and back/forward history lost, pages refetched.
 */
const SplitPane: React.FC<SplitPaneProps> = React.memo(function SplitPane({
  book,
  primary: isPrimary,
  onClosePane,
  readerSettings,
}) {
  const { t } = useLanguage();
  const workspace = useOptionalWorkspace();
  const progress = useReaderProgress(book.bookId, book.title, book.author);
  const startPage =
    progress.progress && progress.progress.pageNumber > 1 ? progress.progress.pageNumber : undefined;
  const reader = useReaderState(book.bookId, startPage);

  // Consume a jump request (Notes panel) on the primary pane only.
  const { goToPage } = reader;
  useEffect(() => {
    if (!workspace?.readerJump) return;
    if (isPrimary && workspace.readerJump.bookId === book.bookId) {
      goToPage(workspace.readerJump.pageNumber);
    }
    workspace?.setReaderJump?.(null);
  }, [workspace, isPrimary, book.bookId, goToPage]);

  // Persist reading progress whenever the page changes.
  const { savePage } = progress;
  useEffect(() => {
    if (!book.bookId || reader.pageCount <= 0) return;
    savePage(book.bookId, reader.currentPageNumber, reader.pageCount);
  }, [book.bookId, reader.currentPageNumber, reader.pageCount, savePage]);

  // Publish the primary pane's current page so the AI Reader panel works.
  useEffect(() => {
    if (!workspace) return;
    if (isPrimary && reader.page?.text) {
      workspace.setReaderPage({
        bookId: book.bookId,
        title: book.title,
        pageNumber: reader.page.pageNumber,
        text: htmlToPlainText(reader.page.text),
      });
    }
    return () => {
      if (isPrimary) workspace.setReaderPage(null);
    };
  }, [workspace, isPrimary, book.bookId, book.title, reader.page]);

  const rtl = document.documentElement.dir === "rtl";
  const PrevIcon = rtl ? ChevronRight : ChevronLeft;
  const NextIcon = rtl ? ChevronLeft : ChevronRight;
  const pageBookmarked = progress.isPageBookmarked(reader.currentPageNumber);

  return (
    <div className="flex flex-col min-w-0 flex-1 bg-background">
      {/* Pane header: title + compact nav + bookmark/favorite. */}
      <div className="flex items-center gap-1 h-9 px-2 border-b border-border shrink-0">
        <BookOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium truncate leading-tight">{book.title}</p>
          {book.author && (
            <p className="text-xs text-muted-foreground truncate leading-tight">{book.author}</p>
          )}
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={reader.prevPage} disabled={reader.currentPageNumber <= 1} title={t("reader.previous_page")} aria-label={t("reader.previous_page")}>
          <PrevIcon className="h-3.5 w-3.5" />
        </Button>
        <span className="text-xs text-muted-foreground px-1 tabular-nums whitespace-nowrap">
          {reader.currentPageNumber} / {reader.pageCount || "…"}
        </span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={reader.nextPage} disabled={reader.currentPageNumber >= reader.pageCount} title={t("reader.next_page")} aria-label={t("reader.next_page")}>
          <NextIcon className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => progress.toggleBookmark(reader.currentPageNumber)}
          title={pageBookmarked ? t("reader.remove_bookmark") : t("reader.bookmark_page")}
          aria-label={pageBookmarked ? t("reader.remove_bookmark") : t("reader.bookmark_page")}
        >
          <Bookmark className={cn("h-3.5 w-3.5", pageBookmarked && "text-primary fill-current")} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={progress.toggleFavorite}
          title={progress.isFavorite ? t("reader.remove_favorite") : t("reader.add_favorite")}
          aria-label={progress.isFavorite ? t("reader.remove_favorite") : t("reader.add_favorite")}
        >
          <Star className={cn("h-3.5 w-3.5", progress.isFavorite && "text-amber-500 fill-current")} />
        </Button>
        {onClosePane && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClosePane} title={t("reader.remove_pane")} aria-label={t("reader.remove_pane")}>
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div
        className="reader-viewport flex-1 min-h-0 overflow-y-auto"
        style={readerSettings.styleProps}
        data-theme={readerSettings.theme}
      >
        <ReaderContent
          page={reader.page}
          loading={reader.pageLoading}
          error={reader.pageError}
          pageNumber={reader.currentPageNumber}
          pageCount={reader.pageCount}
          reader={readerSettings}
        />
      </div>

      <ReaderBottomBar
        currentPage={reader.currentPageNumber}
        pageCount={reader.pageCount}
        onGoToPage={reader.goToPage}
        onPrev={reader.prevPage}
        onNext={reader.nextPage}
      />
    </div>
  );
});

/**
 * SPEC-M6 Phase 9 — Split View.
 *
 * Two Shamela books rendered side by side so the reader can compare texts.
 * Each pane owns an independent `useReaderState` (its own page history,
 * navigation and progress) and `useReaderProgress`; only the typography
 * settings are shared, through the one `useReaderSettings` instance passed to
 * both. A slim per-pane header carries prev/next, page count, bookmark and
 * favorite so the toolbar never becomes a wall of buttons.
 */
export const SplitReader: React.FC<SplitReaderProps> = ({
  primary,
  secondary,
  onClose,
  onCloseSecondary,
  onSwap,
}) => {
  const { t } = useLanguage();
  const readerSettings = useReaderSettings();
  const [swapped, setSwapped] = useState(false);

  const left = swapped ? secondary : primary;
  const right = swapped ? primary : secondary;
  const doSwap = () => {
    setSwapped((s) => !s);
    onSwap?.();
  };

  return (
    <div className="flex flex-col h-full bg-background relative overflow-hidden">
      {/* Split toolbar: shared settings + split controls. */}
      <header className="flex items-center gap-1 h-11 px-2 border-b border-border bg-background/95 backdrop-blur shrink-0">
        <div className="flex items-center min-w-0 mx-1 flex-1">
          <Columns2 className="h-4 w-4 text-muted-foreground shrink-0 mr-2" />
          <div className="min-w-0">
            <p className="text-sm font-medium truncate leading-tight">
              {primary.title} <span className="text-muted-foreground">↔</span> {secondary.title}
            </p>
            <p className="text-xs text-muted-foreground truncate leading-tight">
              {[primary.author, secondary.author].filter(Boolean).join(" · ") || t("reader.split_view")}
            </p>
          </div>
        </div>

        <ReaderSettings reader={readerSettings} />

        {onSwap && (
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={doSwap} title={t("reader.swap_books")} aria-label={t("reader.swap_books")}>
            <ArrowLeftRight className="h-4 w-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onCloseSecondary} title={t("reader.single_view")} aria-label={t("reader.single_view")}>
          <X className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} title={t("reader.close")} aria-label={t("reader.close")}>
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div className="flex-1 min-h-0 flex">
        <SplitPane key={left.bookId} book={left} primary readerSettings={readerSettings} />
        <div className="w-px bg-border shrink-0" />
        <SplitPane
          key={right.bookId}
          book={right}
          onClosePane={onCloseSecondary}
          readerSettings={readerSettings}
        />
      </div>
    </div>
  );
};
