import { toast } from "sonner";
import { Copy, ChevronDown, BookMarked, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isRtlText } from "@/utils/textUtils";
import { cn } from "@/lib/utils";
import type { StructuredCitation } from "@/lib/research/streamers";

interface CitationResponseProps {
  text: string;
  citations: StructuredCitation[];
  /** Total claim segments the pipeline processed. Optional — only set by the
   *  corpus-validated pipeline. */
  totalSegments?: number;
  /** Segments where the LLM picked a citation but DB verification rejected it. */
  rejectedSegments?: number[];
  /** Segments the pipeline could not confidently cite. */
  uncitedSegments?: number[];
  t: import("@/lib/i18n").Translator;
}

/**
 * Strip the «arabic» — "translation" [reference] block down to just [reference]
 * so "Copy reference only" removes the scriptural passage but keeps the source.
 *
 * Pattern: «…» — "…" [reference]  → [reference]
 */
function stripArabicAndTranslation(text: string): string {
  // Handle common delimiters: «…» ‹…› "…"  and — / – / --
  const blockRe = /[«‹"][^»›"]+[»›"]\s*[-—–]{1,2}\s*["'][^"']+["']\s*(\[[^\]]+\])/g;
  return text.replace(blockRe, (_, ref: string) => ref);
}

const CitationResponse = ({
  text,
  citations,
  totalSegments,
  rejectedSegments,
  uncitedSegments,
  t,
}: CitationResponseProps) => {
  const rtl = isRtlText(text);
  const cited = citations.length;
  const total = totalSegments ?? 0;
  const rejected = rejectedSegments?.length ?? 0;
  const uncited  = uncitedSegments?.length ?? 0;
  const showSummary = total > 0;

  const copyFull = async () => {
    await navigator.clipboard.writeText(text);
    toast.success(t("research.copied_full"));
  };

  const copyReferenceOnly = async () => {
    await navigator.clipboard.writeText(stripArabicAndTranslation(text));
    toast.success(t("research.copied_refs_only"));
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <BookMarked className="h-3.5 w-3.5" />
          {citations.length === 0 ? t("research.citations_none") : t("research.citations_title")}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
              <Copy className="h-3 w-3" />
              {t("research.copy")}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={copyFull}>{t("research.copy_full")}</DropdownMenuItem>
            <DropdownMenuItem onClick={copyReferenceOnly}>
              {t("research.copy_reference_only")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div
        dir={rtl ? "rtl" : "ltr"}
        className={cn(
          "whitespace-pre-wrap text-sm text-foreground leading-relaxed",
          rtl && "text-right",
        )}
      >
        {text}
      </div>

      {showSummary && (
        <div className="flex flex-wrap items-center gap-3 text-xs pt-2 border-t border-border/50">
          <span className="flex items-center gap-1 text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-3 w-3" />
            {cited} / {total} {t("research.citations_cited_segments", "segments cited")}
          </span>
          {uncited > 0 && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <BookMarked className="h-3 w-3" />
              {uncited} {t("research.citations_uncited_segments", "without reliable citation")}
            </span>
          )}
          {rejected > 0 && (
            <span
              className="flex items-center gap-1 text-amber-700 dark:text-amber-400"
              title={t("research.citations_rejected_tooltip", "Model picked these but DB verification failed; they were dropped to avoid showing wrong references.")}
            >
              <AlertTriangle className="h-3 w-3" />
              {rejected} {t("research.citations_rejected_segments", "rejected by verifier")}
            </span>
          )}
        </div>
      )}

      {citations.length > 0 && (
        <div className="pt-3 border-t border-border space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {t("research.citations_sources")} ({citations.length})
          </p>
          <ol className="space-y-1.5">
            {citations.map((c) => (
              <li key={c.index} className="text-xs text-muted-foreground flex gap-2">
                <span className="font-mono text-xs text-primary shrink-0">[{c.index}]</span>
                <span className="flex-1">
                  <span className="font-medium text-foreground">{c.reference}</span>
                  {c.source_url && (
                    <>
                      {" · "}
                      <a
                        href={c.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {t("research.citation_view")}
                      </a>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
};

export default CitationResponse;
