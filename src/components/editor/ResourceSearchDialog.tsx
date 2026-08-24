import { useState } from "react";
import { Search, Loader2, BookOpen, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { isRtlText } from "@/utils/textUtils";
import { isDesktop } from "@/core/backend";
import { formatCitation, type ResourceResult } from "@/lib/editor/citationFormat";
import { useResourceSearch, type SourceFilter } from "./useResourceSearch";
import { SOURCE_CHIP_STYLE } from "./sourceColors";
import { ResourceCountCard } from "./ResourceCountCard";
import { ResourceResultCard } from "./ResourceResultCard";
import { useShamelaAvailability } from "@/hooks/useShamelaAvailability";
import { tafsirCall } from "@/lib/tafsir/tafsirService";
import { parseTafsirSources, type TafsirSourceOption } from "@/lib/tafsir/parseTafsir";
import { TafsirGuideModal } from "@/components/tafsir/TafsirGuideModal";
import { ShamelaGuideModal } from "@/components/mcp/ShamelaGuideModal";
import { ShamelaBridgeGuideModal } from "@/components/mcp/ShamelaBridgeGuideModal";

interface ResourceSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the verse/hadith text and its formatted citation when the user inserts a result. */
  onInsert: (text: string, citation: string) => void;
  /** Optional batch insert. When provided, "Insert all" delegates here so the
   *  consumer can apply every citation in one state update (avoids stale-closure
   *  overwrites in React setters). Falls back to serial `onInsert` calls. */
  onInsertMany?: (items: Array<{ text: string; citation: string }>) => void;
  t: import("@/lib/i18n").Translator;
}

/** Sources with their own "not set up" guide, reachable from a disabled chip.
 *  Quran/Hadith are always-on cloud sources and never render disabled. */
const GUIDED_SOURCES: ReadonlySet<SourceFilter> = new Set(["tafsir", "shamela"]);

const ResourceSearchDialog = ({ open, onOpenChange, onInsert, onInsertMany, t }: ResourceSearchDialogProps) => {
  const {
    query, setQuery, runSearch, isSearching, searched,
    response, results, visibleResults, counts, filter, setFilter,
    tafsirAvailable, tafsirSource, setTafsirSource,
  } = useResourceSearch(t);
  const shamelaAvailability = useShamelaAvailability();
  const [tafsirSources, setTafsirSources] = useState<TafsirSourceOption[]>([]);
  const [guideFor, setGuideFor] = useState<"tafsir" | "shamela" | null>(null);

  const ensureTafsirSources = async () => {
    if (tafsirSources.length > 0) return;
    try {
      const res = await tafsirCall("list_tafsir_sources", {});
      setTafsirSources(parseTafsirSources({ text: res.text, structured: res.structured }));
    } catch {
      // Leave the dropdown at "all sources" — a missing source list narrows
      // convenience, not correctness (search_in_tafsir without `source` still
      // searches every source).
    }
  };

  const insertOne = (r: ResourceResult) => {
    onInsert(r.content, formatCitation(r.citation_ref, r.source_url));
    onOpenChange(false);
    toast.success(t("editor.reference_inserted"));
  };

  const insertAll = () => {
    if (visibleResults.length === 0) return;
    const items = visibleResults.map((r) => ({
      text: r.content,
      citation: formatCitation(r.citation_ref, r.source_url),
    }));
    if (onInsertMany) {
      onInsertMany(items);
    } else {
      for (const it of items) onInsert(it.text, it.citation);
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
  const arabicTerms = response?.plan_summary?.arabic_terms ?? [];
  const scopeLabel = response?.plan_summary?.scope_label ?? "";

  const availability: Partial<Record<SourceFilter, boolean>> = {
    tafsir: tafsirAvailable,
    shamela: shamelaAvailability.available,
  };

  const chips: Array<{ value: SourceFilter; label: string; count: number }> = [
    { value: "all", label: t("editor.filter_all"), count: results.length },
    { value: "quran", label: t("editor.filter_quran"), count: counts.quran },
    { value: "hadith", label: t("editor.filter_hadith"), count: counts.hadith },
    { value: "tafsir", label: t("editor.filter_tafsir"), count: counts.tafsir },
    { value: "shamela", label: t("editor.filter_shamela"), count: counts.shamela },
    { value: "other", label: t("editor.filter_other"), count: counts.other },
  ];

  return (
    <>
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
          {filter === "tafsir" && tafsirAvailable && (
            <Select
              value={tafsirSource || "__all__"}
              onValueChange={(v) => setTafsirSource(v === "__all__" ? "" : v)}
              onOpenChange={(o) => { if (o) void ensureTafsirSources(); }}
            >
              <SelectTrigger className="w-[160px] shrink-0 text-xs">
                <SelectValue placeholder={t("editor.tafsir_source_label")} />
              </SelectTrigger>
              <SelectContent dir="rtl">
                <SelectItem value="__all__">{t("editor.tafsir_source_default")}</SelectItem>
                {tafsirSources.map((s) => (
                  <SelectItem key={s.slug} value={s.slug}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button onClick={runSearch} disabled={isSearching || !query.trim()} className="gap-1.5 shrink-0">
            {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {t("editor.search_btn")}
          </Button>
        </div>

        {arabicTerms.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              {t("editor.searched_terms")}
            </span>
            {arabicTerms.map((term) => (
              <span
                key={term}
                dir="rtl"
                className="rounded-full border border-border bg-muted px-2 py-0.5 font-medium"
              >
                {term}
              </span>
            ))}
            {scopeLabel && (
              <span className="text-muted-foreground" dir="rtl">· {scopeLabel}</span>
            )}
          </div>
        )}

        <ScrollArea className="max-h-[55vh] -mx-2 px-2">
          <div className="space-y-3">
            {isCount && response?.count && (
              <ResourceCountCard count={response.count} onInsertSummary={insertCountSummary} t={t} />
            )}

            {/* ── Filters + insert all ────────────────────────────────────── */}
            {searched && !isSearching && (
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1 flex-wrap">
                  {chips.map(({ value, label, count }) => {
                    const guided = GUIDED_SOURCES.has(value);
                    const isAvailable = !guided || availability[value];

                    if (guided && !isAvailable) {
                      return (
                        <button
                          key={value}
                          onClick={() => setGuideFor(value as "tafsir" | "shamela")}
                          className="rounded-md border border-dashed border-border px-2 py-1 text-xs font-medium text-muted-foreground/70 hover:bg-muted transition-colors"
                        >
                          {label} ({t("editor.source_unavailable")})
                        </button>
                      );
                    }

                    if (count === 0 && value !== "all") return null;

                    const colorClass = SOURCE_CHIP_STYLE[value];
                    return (
                      <button
                        key={value}
                        onClick={() => setFilter(value)}
                        className={cn(
                          "rounded-md px-2 py-1 text-xs font-medium transition-colors border border-transparent",
                          filter === value
                            ? "bg-primary text-primary-foreground"
                            : colorClass || "text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {label} ({count})
                      </button>
                    );
                  })}
                </div>
                {visibleResults.length > 1 && (
                  <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={insertAll}>
                    <Plus className="h-3.5 w-3.5" />
                    {t("editor.insert_all")}
                  </Button>
                )}
              </div>
            )}

            {visibleResults.map((r, i) => (
              <ResourceResultCard key={r.match_key ?? i} result={r} onInsert={insertOne} t={t} />
            ))}

            {searched && !isSearching && results.length === 0 && !isCount && (
              <p className="text-sm text-muted-foreground text-center py-8">{t("editor.no_results")}</p>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>

    <TafsirGuideModal open={guideFor === "tafsir"} onOpenChange={(o) => !o && setGuideFor(null)} />
    {isDesktop() ? (
      <ShamelaGuideModal open={guideFor === "shamela"} onOpenChange={(o) => !o && setGuideFor(null)} />
    ) : (
      <ShamelaBridgeGuideModal open={guideFor === "shamela"} onOpenChange={(o) => !o && setGuideFor(null)} />
    )}
    </>
  );
};

export default ResourceSearchDialog;
