import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useReaderState, type TocEntry } from "@/hooks/useReaderState";
import { useReaderSettings } from "@/hooks/useReaderSettings";
import { useReaderProgress } from "@/hooks/useReaderProgress";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import { htmlToPlainText } from "@/lib/reader/htmlToPlainText";
import { ReaderToolbar } from "./ReaderToolbar";
import { ReaderSettings } from "./ReaderSettings";
import { TocTree } from "./TocTree";
import { ReaderContent } from "./ReaderContent";
import { ReaderBottomBar } from "./ReaderBottomBar";
import { PdfViewerDialog } from "./PdfViewerDialog";

interface ShamelaReaderProps {
  bookId: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
  /** Deep-link target: open the reader on this page instead of page 1. */
  initialPage?: number | null;
  /** SPEC-M6 Phase 9: request side-by-side comparison of this book. */
  onRequestSplit?: () => void;
}

/**
 * Library Mode reader (SPEC-M6 Phase 2/3). Renders a Shamela book's pages from
 * the local installation, with a TOC tree on the left, page navigation in the
 * toolbar and bottom bar, back/forward history, Phase-3 typography settings,
 * and Phase-8 progress/bookmarks/favorites.
 */
export const ShamelaReader: React.FC<ShamelaReaderProps> = ({
  bookId,
  title,
  subtitle,
  onClose,
  initialPage,
  onRequestSplit,
}) => {
  const [tocOpen, setTocOpen] = useState(true);
  const [pdfOpen, setPdfOpen] = useState(false);

  // SPEC-M6 Phase 8: resume on the last-read page when there is no deep-link
  // page target. useReaderState's guard is keyed on bookId+startPage, so this
  // resolves asynchronously and still opens on the saved page, not page 1.
  const readerProgress = useReaderProgress(bookId, title, subtitle);
  const startPage = initialPage && initialPage > 1
    ? initialPage
    : (readerProgress.progress && readerProgress.progress.pageNumber > 1
        ? readerProgress.progress.pageNumber
        : undefined);

  const reader = useReaderState(bookId, startPage);
  const readerSettings = useReaderSettings();
  const workspace = useOptionalWorkspace();

  // SPEC-M6 Phase 8: consume a jump request from the Notes panel (Workbench →
  // Reader). Ignore requests for a different book and clear them either way so
  // the same page can be requested again later.
  const { goToPage } = reader;
  useEffect(() => {
    if (!workspace?.readerJump) return;
    if (workspace.readerJump.bookId === bookId) {
      goToPage(workspace.readerJump.pageNumber);
    }
    workspace.setReaderJump(null);
  }, [workspace, bookId, goToPage]);

  // SPEC-M6 Phase 8: persist reading progress whenever the page changes. The
  // hook debounces internally, so rapid page-flips only commit the final page.
  const { savePage } = readerProgress;
  useEffect(() => {
    if (!bookId || reader.pageCount <= 0) return;
    savePage(bookId, reader.currentPageNumber, reader.pageCount);
  }, [bookId, reader.currentPageNumber, reader.pageCount, savePage]);

  // SPEC-M6 Phase 7: publish the current page (plain text) so the AI Reader
  // panel in the Workbench can use it as context. Cleared on unmount.
  useEffect(() => {
    if (!workspace) return;
    if (reader.page?.text) {
      workspace.setReaderPage({
        bookId,
        title,
        pageNumber: reader.page.pageNumber,
        text: htmlToPlainText(reader.page.text),
      });
    }
    return () => workspace.setReaderPage(null);
  }, [workspace, bookId, title, reader.page]);

  const handleSelectToc = (entry: TocEntry) => {
    reader.goToTocEntry(entry);
  };

  return (
    <div className="flex flex-col h-full bg-background relative overflow-hidden">
      <ReaderToolbar
        title={title}
        subtitle={subtitle}
        currentPage={reader.currentPageNumber}
        pageCount={reader.pageCount}
        canGoBack={reader.canGoBack}
        canGoForward={reader.canGoForward}
        tocOpen={tocOpen}
        onToggleToc={() => setTocOpen((open) => !open)}
        onBack={reader.back}
        onForward={reader.forward}
        onPrev={reader.prevPage}
        onNext={reader.nextPage}
        onClose={onClose}
        settingsSlot={<ReaderSettings reader={readerSettings} />}
        bookmarked={readerProgress.bookmarked}
        onToggleBookmark={() => readerProgress.toggleBookmark(reader.currentPageNumber)}
        isFavorite={readerProgress.isFavorite}
        onToggleFavorite={readerProgress.toggleFavorite}
        onRequestSplit={onRequestSplit}
        onRequestPdf={() => setPdfOpen(true)}
      />

      <div className="flex-1 min-h-0 flex">
        {tocOpen && (
          <aside
            className={cn(
              "w-64 border-e border-border bg-muted/30 shrink-0 overflow-y-auto",
              "max-md:absolute max-md:inset-y-0 max-md:start-0 max-md:z-20 max-md:bg-background max-md:shadow-xl",
            )}
            aria-label="Table of contents"
          >
            <TocTree
              toc={reader.toc}
              loading={reader.tocLoading}
              error={reader.tocError}
              activeTitleId={reader.currentTitleId}
              onSelect={handleSelectToc}
            />
          </aside>
        )}

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
      </div>

      <ReaderBottomBar
        currentPage={reader.currentPageNumber}
        pageCount={reader.pageCount}
        onGoToPage={reader.goToPage}
        onPrev={reader.prevPage}
        onNext={reader.nextPage}
      />

      {/* SPEC-M6 Phase 10: in-app PDF viewer (page nav, zoom). */}
      <PdfViewerDialog
        open={pdfOpen}
        onOpenChange={setPdfOpen}
        bookId={bookId}
        title={title}
        author={subtitle}
      />
    </div>
  );
};
