import { toast } from "sonner";
import { Copy, ChevronDown, BookMarked } from "lucide-react";
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
  t: (k: string) => string;
}

/**
 * Strip the «arabic» — "translation" [reference] block down to just [reference]
 * so "Copy reference only" removes the scriptural passage but keeps the source.
 *
 * Pattern: «…» — "…" [reference]  → [reference]
 */
function stripArabicAndTranslation(text: string): string {
  // Handle common delimiters: «…» ‹…› "…"  and — / – / --
  const blockRe = /[«‹"][^»›"]+[»›"]\s*[—–\-]{1,2}\s*["'][^"']+["']\s*(\[[^\]]+\])/g;
  return text.replace(blockRe, (_, ref: string) => ref);
}

const CitationResponse = ({ text, citations, t }: CitationResponseProps) => {
  const rtl = isRtlText(text);

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

      {citations.length > 0 && (
        <div className="pt-3 border-t border-border space-y-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
            {t("research.citations_sources")} ({citations.length})
          </p>
          <ol className="space-y-1.5">
            {citations.map((c) => (
              <li key={c.index} className="text-xs text-muted-foreground flex gap-2">
                <span className="font-mono text-[10px] text-primary shrink-0">[{c.index}]</span>
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
