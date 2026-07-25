import { useState, useCallback, useMemo } from "react";
import { Search, Loader2, BookOpen, Plus, Info, Hash, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { isRtlText } from "@/utils/textUtils";
import {
  formatCitation,
  type ResourceResult,
  type CitationSearchResponse,
} from "@/lib/editor/citationFormat";

interface ResourceSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the verse/hadith text and its formatted citation when the user inserts a result. */
  onInsert: (text: string, citation: string) => void;
  /** Optional batch insert. When provided, "Insert all" delegates here so the
   *  consumer can apply every citation in one state update (avoids stale-closure
   *  overwrites in React setters). Falls back to serial `onInsert` calls. */
  onInsertMany?: (items: Array<{ text: string; citation: string }>) => void;
  t: (k: string) => string;
}


type SourceFilter = "all" | "quran" | "hadith";

const ResourceSearchDialog = ({ open, onOpenChange, onInsert, t }: ResourceSearchDialogProps) => {
  const { session } = useAuth();
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<CitationSearchResponse | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [filter, setFilter] = useState<SourceFilter>("all");

  const runSearch = useCallback(async () => {
    if (!query.trim() || !session?.access_token) return;
    setIsSearching(true);
    setSearched(true);
    setFilter("all");
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/resource-search`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ query }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || t("editor.search_error"));
        setResponse(null);
        return;
      }
      setResponse((await res.json()) as CitationSearchResponse);
    } catch {
      toast.error(t("editor.search_error"));
      setResponse(null);
    } finally {
      setIsSearching(false);
    }
  }, [query, session, t]);

  const results = response?.results ?? [];

  const sourceTypeOf = (r: ResourceResult): SourceFilter =>
    r.source_type === "quran" || r.citation_ref?.surah_number != null ? "quran" : "hadith";

  const visibleResults = useMemo(
    () => (filter === "all" ? results : results.filter((r) => sourceTypeOf(r) === filter)),
    [results, filter],
  );

  const counts = useMemo(() => ({
    quran: results.filter((r) => sourceTypeOf(r) === "quran").length,
    hadith: results.filter((r) => sourceTypeOf(r) === "hadith").length,
  }), [results]);

  const insertOne = (r: ResourceResult) => {
    onInsert(r.content, formatCitation(r.citation_ref, r.source_url));
    onOpenChange(false);
    toast.success(t("editor.reference_inserted"));
  };

  const insertAll = () => {
    if (visibleResults.length === 0) return;
    // Insert each passage as its own quote block with its own citation, so
    // the editor renders separate paragraphs instead of collapsing everything
    // into one blob with a single mashed-together bracket.
    for (const r of visibleResults) {
      onInsert(r.content, formatCitation(r.citation_ref, r.source_url));
    }
    onOpenChange(false);
    toast.success(t("editor.reference_inserted"));
  };

  /** Insert the count answer as a sentence the user can keep in their document. */
  const insertCountSummary = () => {
    const c = response?.count;
    if (!c) return;
    const terms = (response?.plan_summary?.arabic_terms ?? []).join("، ");
    const scope = response?.plan_summary?.scope_label ?? "";
    const summary =
      `${scope}: «${terms}» ${t("editor.count_summary_occurrences")} ${c.total} ` +
      `(${c.rows_matched} ${t("editor.count_summary_places")})`;
    onInsert(summary, "");
    onOpenChange(false);
    toast.success(t("editor.reference_inserted"));
  };

  const isCount = response?.intent === "count" && !!response.count;
  // Defensive: an older/cached `resource-search` (or any non-engine response)
  // may omit plan_summary. Never dereference it directly — a missing field
  // must degrade the UI, not white-screen the whole editor.
  const arabicTerms = response?.plan_summary?.arabic_terms ?? [];
  const scopeLabel = response?.plan_summary?.scope_label ?? "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            {t("editor.search_resources")}
          </DialogTitle>
          <DialogDescription>{t("editor.search_resources_hint")}</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
            dir={isRtlText(query) ? "rtl" : "ltr"}
            className={cn(isRtlText(query) && "text-right")}
            placeholder={t("editor.search_placeholder")}
          />
          <Button onClick={runSearch} disabled={isSearching || !query.trim()} className="gap-1.5 shrink-0">
            {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {t("editor.search_btn")}
          </Button>
        </div>

        {/* What the engine actually searched for — the Arabic surface forms it
            derived from the question. Makes an otherwise opaque expansion step
            inspectable, so a bad result is diagnosable by the user. */}
        {arabicTerms.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-muted-foreground flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              {t("editor.searched_terms")}
            </span>
            {arabicTerms.map((term) => (
              <span
                key={term}
                dir="rtl"
                className="rounded-full border border-border bg-muted/50 px-2 py-0.5 font-medium"
              >
                {term}
              </span>
            ))}
            {scopeLabel && (
              <span className="text-muted-foreground" dir="rtl">
                · {scopeLabel}
              </span>
            )}
          </div>
        )}

        <ScrollArea className="max-h-[55vh] -mx-2 px-2">
          <div className="space-y-3">
            {/* ── Count answer ────────────────────────────────────────────── */}
            {isCount && response?.count && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
                <div className="flex items-baseline gap-2">
                  <Hash className="h-4 w-4 text-primary self-center" />
                  <span className="text-3xl font-bold tabular-nums">{response.count.total}</span>
                  <span className="text-sm text-muted-foreground">
                    {t("editor.count_occurrences")}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {response.count.rows_matched} {t("editor.count_in_places")}
                </p>

                {response.count.buckets.length > 0 && (
                  <div className="mt-3 max-h-44 overflow-y-auto rounded-md border border-border/60 bg-background/60">
                    <table className="w-full text-xs">
                      <tbody>
                        {response.count.buckets.map((b) => (
                          <tr key={`${b.source_type}-${b.key}`} className="border-b border-border/40 last:border-0">
                            <td className="px-2.5 py-1.5" dir="rtl">{b.label}</td>
                            <td className="px-2.5 py-1.5 text-right tabular-nums font-medium">
                              {b.occurrences}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {response.count.caveats.length > 0 && (
                  <div className="mt-3 flex gap-1.5 text-[11px] text-muted-foreground">
                    <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <ul className="space-y-0.5" dir="rtl">
                      {response.count.caveats.map((c, i) => <li key={i}>{c}</li>)}
                    </ul>
                  </div>
                )}

                <Button size="sm" variant="outline" className="mt-3 h-7 gap-1 text-xs" onClick={insertCountSummary}>
                  <Plus className="h-3.5 w-3.5" />
                  {t("editor.insert_count_summary")}
                </Button>
              </div>
            )}

            {/* ── Filters + insert all ────────────────────────────────────── */}
            {results.length > 0 && (
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  {([
                    ["all", t("editor.filter_all"), results.length],
                    ["quran", t("editor.filter_quran"), counts.quran],
                    ["hadith", t("editor.filter_hadith"), counts.hadith],
                  ] as const).map(([value, label, n]) =>
                    n > 0 || value === "all" ? (
                      <button
                        key={value}
                        onClick={() => setFilter(value as SourceFilter)}
                        className={cn(
                          "rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                          filter === value
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {label} ({n})
                      </button>
                    ) : null,
                  )}
                </div>
                {visibleResults.length > 1 && (
                  <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={insertAll}>
                    <Plus className="h-3.5 w-3.5" />
                    {t("editor.insert_all")}
                  </Button>
                )}
              </div>
            )}

            {/* ── Result cards ───────────────────────────────────────────── */}
            {visibleResults.map((r, i) => {
              const rtl = isRtlText(r.content);
              return (
                <div key={r.match_key ?? i} className="rounded-lg border border-border bg-muted/20 p-3 group">
                  <p
                    dir={rtl ? "rtl" : "ltr"}
                    className={cn("text-sm leading-relaxed line-clamp-4", rtl && "text-right")}
                  >
                    {r.content}
                  </p>
                  {r.reason && (
                    <p className="mt-1.5 text-[11px] text-primary/80" dir="rtl">{r.reason}</p>
                  )}
                  <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-border/60">
                    <span className="text-[11px] text-muted-foreground truncate">
                      {formatCitation(r.citation_ref, r.source_url)}
                    </span>
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs shrink-0" onClick={() => insertOne(r)}>
                      <Plus className="h-3.5 w-3.5" />
                      {t("editor.insert")}
                    </Button>
                  </div>
                </div>
              );
            })}

            {searched && !isSearching && results.length === 0 && !isCount && (
              <p className="text-sm text-muted-foreground text-center py-8">{t("editor.no_results")}</p>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};

export default ResourceSearchDialog;
