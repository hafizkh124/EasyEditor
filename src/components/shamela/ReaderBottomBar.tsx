import React, { useState, useEffect } from "react";
import { ChevronRight, ChevronLeft, CornerDownLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";

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
  const { t, direction } = useLanguage();
  const [value, setValue] = useState(String(currentPage));

  useEffect(() => {
    setValue(String(currentPage));
  }, [currentPage]);

  const rtl = direction === "rtl";
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
      <Button variant="ghost" size="icon" className="h-7 w-7 min-h-touch min-w-touch md:min-h-0 md:min-w-0" onClick={onPrev} disabled={currentPage <= 1} title={t("reader.previous_page")} aria-label={t("reader.previous_page")}>
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
          aria-label={t("reader.jump_to_page")}
        />
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          / {pageCount || "…"}
        </span>
        <Button variant="ghost" size="icon" type="submit" className="h-7 w-7 min-h-touch min-w-touch md:min-h-0 md:min-w-0" title={t("reader.go_to_page")} aria-label={t("reader.go_to_page")}>
          <CornerDownLeft className="h-3.5 w-3.5" />
        </Button>
      </form>

      <Button variant="ghost" size="icon" className="h-7 w-7 min-h-touch min-w-touch md:min-h-0 md:min-w-0" onClick={onNext} disabled={currentPage >= pageCount} title={t("reader.next_page")} aria-label={t("reader.next_page")}>
        <NextIcon className="h-3.5 w-3.5" />
      </Button>
    </footer>
  );
};
