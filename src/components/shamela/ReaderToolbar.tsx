import React from "react";
import {
  ArrowRight,
  ArrowLeft,
  BookOpen,
  ChevronRight,
  ChevronLeft,
  ListTree,
  Star,
  Bookmark,
  Columns2,
  FileText,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ReaderToolbarProps {
  title: string;
  subtitle?: string;
  currentPage: number;
  pageCount: number;
  canGoBack: boolean;
  canGoForward: boolean;
  tocOpen: boolean;
  onToggleToc: () => void;
  onBack: () => void;
  onForward: () => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  settingsSlot?: React.ReactNode;
  /** SPEC-M6 Phase 8: bookmark/favorite toggles for the current page/book. */
  bookmarked?: boolean;
  onToggleBookmark?: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  /** SPEC-M6 Phase 9: open side-by-side comparison. */
  onRequestSplit?: () => void;
  /** SPEC-M6 Phase 10: open the in-app PDF viewer for this book. */
  onRequestPdf?: () => void;
}

export const ReaderToolbar: React.FC<ReaderToolbarProps> = ({
  title,
  subtitle,
  currentPage,
  pageCount,
  canGoBack,
  canGoForward,
  tocOpen,
  onToggleToc,
  onBack,
  onForward,
  onPrev,
  onNext,
  onClose,
  settingsSlot,
  bookmarked = false,
  onToggleBookmark,
  isFavorite = false,
  onToggleFavorite,
  onRequestSplit,
  onRequestPdf,
}) => {
  const rtl = document.documentElement.dir === "rtl";
  const PrevIcon = rtl ? ChevronRight : ChevronLeft;
  const NextIcon = rtl ? ChevronLeft : ChevronRight;

  return (
    <header className="flex items-center gap-1 h-11 px-2 border-b border-border bg-background/95 backdrop-blur shrink-0">
      <Button
        variant="ghost"
        size="icon"
        className={cn("h-8 w-8", tocOpen && "bg-accent text-accent-foreground")}
        onClick={onToggleToc}
        title="Contents"
      >
        <ListTree className="h-4 w-4" />
      </Button>

      <div className="flex items-center min-w-0 mx-1 flex-1">
        <BookOpen className="h-4 w-4 text-muted-foreground shrink-0 mr-2" />
        <div className="min-w-0">
          <p className="text-sm font-medium truncate leading-tight">{title}</p>
          {subtitle && (
            <p className="text-[11px] text-muted-foreground truncate leading-tight">{subtitle}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-0.5">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack} disabled={!canGoBack} title="Back">
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onForward} disabled={!canGoForward} title="Forward">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="w-px h-4 bg-border mx-1" />
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onPrev} disabled={currentPage <= 1} title="Previous page">
          <PrevIcon className="h-4 w-4" />
        </Button>
        <span className="text-[11px] text-muted-foreground px-1 tabular-nums whitespace-nowrap">
          {currentPage} / {pageCount || "…"}
        </span>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onNext} disabled={currentPage >= pageCount} title="Next page">
          <NextIcon className="h-4 w-4" />
        </Button>
      </div>

      {settingsSlot}

      <div className="flex items-center gap-0.5">
        {onToggleBookmark && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onToggleBookmark}
            title={bookmarked ? "Remove bookmark from this page" : "Bookmark this page"}
          >
            <Bookmark className={cn("h-4 w-4", bookmarked && "text-primary fill-current")} />
          </Button>
        )}
        {onToggleFavorite && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onToggleFavorite}
            title={isFavorite ? "Remove from favorites" : "Add to favorites"}
          >
            <Star className={cn("h-4 w-4", isFavorite && "text-amber-500 fill-current")} />
          </Button>
        )}
        {onRequestSplit && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onRequestSplit}
            title="Compare side by side (split view)"
          >
            <Columns2 className="h-4 w-4" />
          </Button>
        )}
        {onRequestPdf && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onRequestPdf}
            title="Open PDF"
          >
            <FileText className="h-4 w-4" />
          </Button>
        )}
      </div>

      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} title="Close reader">
        <X className="h-4 w-4" />
      </Button>
    </header>
  );
};
