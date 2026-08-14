import React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TocEntry } from "@/hooks/useReaderState";
import { useLanguage } from "@/contexts/LanguageContext";

interface TocTreeProps {
  toc: TocEntry[];
  loading: boolean;
  error: string | null;
  activeTitleId: string | null;
  onSelect: (entry: TocEntry) => void;
}

/**
 * A table of contents with hierarchy (depth = 0 for the top-level chapters,
 * deeper for sub-headings). Shamela's own tree treats every title as a leaf of
 * its parent; this renders the same nesting Shamela 4 shows in its left pane.
 */
export const TocTree: React.FC<TocTreeProps> = ({
  toc,
  loading,
  error,
  activeTitleId,
  onSelect,
}) => {
  const { t } = useLanguage();
  if (loading) {
    return <p className="p-3 text-xs text-muted-foreground">{t("reader.toc.loading")}</p>;
  }
  if (error) {
    return <p className="p-3 text-xs text-destructive">{error}</p>;
  }
  if (toc.length === 0) {
    return <p className="p-3 text-xs text-muted-foreground">{t("reader.toc.empty")}</p>;
  }

  return (
    <nav className="py-1" aria-label={t("reader.contents")}>
      {toc.map((entry) => {
        const active = entry.titleId === activeTitleId;
        return (
          <button
            key={entry.titleId}
            type="button"
            onClick={() => onSelect(entry)}
            className={cn(
              "w-full text-right flex items-start gap-1.5 px-2 py-1.5 text-xs leading-relaxed transition-colors border-e-2 border-transparent hover:bg-accent hover:text-accent-foreground",
              active && "border-primary bg-accent/50 text-accent-foreground font-medium",
            )}
            style={{ paddingRight: `${(entry.depth + 1) * 10}px` }}
            aria-current={active ? "true" : undefined}
            title={entry.text}
          >
            {entry.depth > 0 && (
              <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
            )}
            <span className="truncate">{entry.text}</span>
          </button>
        );
      })}
    </nav>
  );
};
