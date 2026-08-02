import React, { useState, useEffect } from "react";
import { ChevronRight, ChevronLeft, CornerDownLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ReaderBottomBarProps {
  currentPage: number;
  pageCount: number;
  onGoToPage: (page: number) => void;
  onPrev: () => void;
  onNext: () => void;
}

export const ReaderBottomBar: React.FC<ReaderBottomBarProps> = ({
  currentPage,
  pageCount,
  onGoToPage,
  onPrev,
  onNext,
}) => {
  const [value, setValue] = useState(String(currentPage));

  useEffect(() => {
    setValue(String(currentPage));
  }, [currentPage]);

  const rtl = document.documentElement.dir === "rtl";
  const PrevIcon = rtl ? ChevronRight : ChevronLeft;
  const NextIcon = rtl ? ChevronLeft : ChevronRight;

  const commit = () => {
    const n = Number.parseInt(value, 10);
    if (Number.isNaN(n)) {
      setValue(String(currentPage));
      return;
    }
    onGoToPage(Math.max(1, Math.min(n, pageCount || n)));
  };

  return (
    <footer className="flex items-center justify-center gap-2 h-10 border-t border-border px-3 bg-background/95 backdrop-blur shrink-0">
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onPrev} disabled={currentPage <= 1} title="Previous page">
        <PrevIcon className="h-3.5 w-3.5" />
      </Button>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          commit();
        }}
        className="flex items-center gap-1"
      >
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          inputMode="numeric"
          className="h-7 w-16 text-center text-xs tabular-nums"
          aria-label="Jump to page"
        />
        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
          / {pageCount || "…"}
        </span>
        <Button variant="ghost" size="icon" type="submit" className="h-7 w-7" title="Go to page">
          <CornerDownLeft className="h-3.5 w-3.5" />
        </Button>
      </form>

      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onNext} disabled={currentPage >= pageCount} title="Next page">
        <NextIcon className="h-3.5 w-3.5" />
      </Button>
    </footer>
  );
};
