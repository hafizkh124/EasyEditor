import React from "react";
import {
  ArrowRight,
  ArrowLeft,
  BookOpen,
  ChevronRight,
  ChevronLeft,
  ListTree,
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

      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} title="Close reader">
        <X className="h-4 w-4" />
      </Button>
    </header>
  );
};
