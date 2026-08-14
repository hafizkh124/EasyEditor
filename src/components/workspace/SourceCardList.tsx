import React from "react";
import { ExternalLink, BookMarked, FileSearch } from "lucide-react";
import CitationBadge from "@/components/research/CitationBadge";
import { EmptyState } from "./EmptyState";
import { domainLabel, groupByDomain } from "@/lib/citations/domains";
import { useLanguage } from "@/contexts/LanguageContext";
import type { TaskRunSource } from "@/core/workspace/types";

interface SourceCardListProps {
  sources: TaskRunSource[];
}

/**
 * The sources a citation run actually retrieved (SPEC-M3 FR-4.5/FR-4.6).
 *
 * Rendering reuses `CitationBadge` and the shared domain vocabulary rather than
 * re-deriving reference formatting — the badge already knows how to print a
 * hadith, an ayah, a fatwa and a classical work.
 */
export const SourceCardList: React.FC<SourceCardListProps> = ({ sources }) => {
  const { t } = useLanguage();
  if (!sources || sources.length === 0) {
    return (
      <EmptyState
        icon={FileSearch}
        title={t("library.no_sources_in_run", "No sources were retrieved in this run.")}
        compact
      />
    );
  }

  const groups = groupByDomain(sources);

  return (
    <div className="space-y-2">
      {Object.entries(groups).map(([domain, items]) => (
        <div key={domain} className="space-y-1">
          <div className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
            <BookMarked className="h-3.5 w-3.5 shrink-0" />
            <span>{domainLabel(domain)}</span>
            <span className="opacity-60">({items.length})</span>
          </div>

          {items.map((s, i) => (
            <div
              key={`${domain}-${i}`}
              className="rounded border border-border bg-muted/60 p-2 space-y-1"
            >
              <div className="flex items-start justify-between gap-2">
                <CitationBadge domain={s.domain} citationRef={s.citation_ref ?? {}} />
                {/* Only ever a link the corpus supplied — the server sends null
                    rather than a guess, and we must not invent one here either. */}
                {s.source_url && (
                  <a
                    href={s.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-primary hover:underline"
                    aria-label={t("library.open_source", "{reference} — open original source").replace("{reference}", s.reference)}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>

              {s.snippet && (
                <p className="text-xs leading-relaxed text-muted-foreground line-clamp-3" dir="auto">
                  {s.snippet}
                </p>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

export default SourceCardList;
