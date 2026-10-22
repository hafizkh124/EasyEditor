import React from "react";
import { ChevronRight, ChevronLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import type { BookPage } from "@/hooks/useBookTranslation";

interface BookPageViewerProps {
  pages: BookPage[];
  currentPage: number;
  totalPages: number;
  loadedCount: number;
  isLoadingSource: boolean;
  onPageChange: (page: number) => void;
}

/**
 * Left pane for a `source: "pdf"` (or single-image) book: the current page's
 * rendered image (this data already existed in the old Quick Translate
 * sidebar's state — it was simply never displayed anywhere) plus real page
 * navigation, which is the other half of the bug this feature fixes.
 *
 * The status strip is intentionally text/icon dots, not page thumbnails —
 * rendering a thumbnail image per page doesn't scale to a few-hundred-page
 * book, while a row of status dots does.
 */
export const BookPageViewer: React.FC<BookPageViewerProps> = ({
  pages, currentPage, totalPages, loadedCount, isLoadingSource, onPageChange,
}) => {
  const { t } = useLanguage();
  const [pageInput, setPageInput] = React.useState(String(currentPage));

  React.useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  const page = pages.find((p) => p.pageNum === currentPage);

  const commitPageInput = () => {
    const n = parseInt(pageInput, 10);
    if (!Number.isNaN(n)) onPageChange(n);
    else setPageInput(String(currentPage));
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-muted/60">
      <div className="flex items-center gap-2 px-3 h-11 border-b border-border shrink-0 bg-background">
        <Button
          variant="ghost" size="icon" className="h-8 w-8 shrink-0"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          aria-label={t("translate.prev_page", "پچھلا صفحہ")}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
          <Input
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onBlur={commitPageInput}
            onKeyDown={(e) => { if (e.key === "Enter") commitPageInput(); }}
            className="h-7 w-14 text-center text-xs tabular-nums"
            aria-label={t("translate.page_number", "صفحہ نمبر")}
          />
          <span className="tabular-nums whitespace-nowrap">
            / {totalPages || "…"}
          </span>
        </div>
        <Button
          variant="ghost" size="icon" className="h-8 w-8 shrink-0"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          aria-label={t("translate.next_page", "اگلا صفحہ")}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        {isLoadingSource && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground ms-auto">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("translate.pages_prepared", "{loaded} / {total} صفحات تیار").replace("{loaded}", String(loadedCount)).replace("{total}", String(totalPages || loadedCount))}
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto flex items-start justify-center p-4">
        {page?.imageBase64 ? (
          <img
            src={`data:image/jpeg;base64,${page.imageBase64}`}
            alt={t("translate.page_alt", "صفحہ {page}").replace("{page}", String(currentPage))}
            className="max-w-full h-auto shadow-md rounded-sm bg-white"
          />
        ) : (
          <div className="flex-1 flex items-center justify-center py-20 text-xs text-muted-foreground">
            {isLoadingSource ? t("translate.loading_page", "صفحہ تیار ہو رہا ہے…") : t("translate.no_page", "یہ صفحہ دستیاب نہیں")}
          </div>
        )}
      </div>

      {pages.length > 0 && (
        <ScrollArea className="shrink-0 border-t border-border bg-background">
          <div className="flex gap-1 p-1.5">
            {pages.map((p) => (
              <button
                key={p.pageNum}
                type="button"
                onClick={() => onPageChange(p.pageNum)}
                title={String(p.pageNum)}
                className={cn(
                  "h-2 w-2 rounded-full shrink-0 transition-colors",
                  p.pageNum === currentPage && "ring-2 ring-primary ring-offset-1",
                  p.status === "done" && "bg-success",
                  p.status === "failed" && "bg-destructive",
                  p.status === "translating" && "bg-warning animate-pulse",
                  p.status === "pending" && "bg-muted-foreground/30",
                )}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
};

export default BookPageViewer;
