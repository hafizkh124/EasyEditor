import React, { useState, useEffect } from "react";
import { Search, FileText, Loader2, Languages, BookOpen } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmptyState } from "./EmptyState";
import { libraryItemService } from "@/core/workspace/libraryItemService";
import { searchShamelaAsChunks } from "@/lib/shamela/localShamelaService";
import type { ChunkSearchHit } from "@/core/backend/types";
import { stripHarakat } from "@/utils/arabicUtils";
import { useLanguage } from "@/contexts/LanguageContext";

interface SearchTabProps {
  onSelectResult?: (hit: ChunkSearchHit) => void;
  onNavigate?: () => void;
}

/**
 * SPEC-M6 Phase 5/6 — Keyword + Root Search over the Shamela library.
 *
 * Plain search goes through Shamela's own Lucene index — natively on desktop,
 * via the local bridge on web (see localShamelaService). It used to search only
 * books already imported into the workspace, which on web meant a permanently
 * empty tab: the cloud backend's `searchChunks` is a stub returning nothing.
 * Sitting inside the Shamela tab, searching Shamela is also what a reader
 * expects. Results show the book title and a snippet around the match; clicking
 * one opens the reader on that page.
 *
 * Root search is the exception and still runs over imported chunks: it needs
 * Shamela's S2.db morphology tables through the desktop FTS5 path, so كتب also
 * matches مكتوب، الكاتب، بكتابة … (Phase 6). The toggle is disabled without S2.db.
 */
export const SearchTab: React.FC<SearchTabProps> = ({ onSelectResult, onNavigate }) => {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChunkSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rootMode, setRootMode] = useState(false);
  const [s2DbPath, setS2DbPath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const state = await window.electronAPI?.shamela?.detect();
        if (!cancelled) setS2DbPath(state?.s2DbPath ?? null);
      } catch {
        // Root search simply stays off without S2.db.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // `useRoot` is an explicit parameter, not a read of the `rootMode` state,
  // because the root-search toggle's own handler calls this in the SAME tick
  // it calls setRootMode(next) — reading `rootMode` there would close over the
  // pre-toggle value (a real bug this fixed: enabling root search with a
  // query already typed searched in the OLD mode, not the new one).
  const runSearch = async (q: string, useRoot: boolean) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setResults([]);
      setSearched(false);
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const hits = useRoot
        ? await libraryItemService.searchChunksByRoot(s2DbPath, trimmed, 100)
        : await searchShamelaAsChunks(trimmed, 100);
      setResults(hits);
      setSearched(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("library.search_failed", "Search failed."));
      setResults([]);
      setSearched(true);
    } finally {
      setSearching(false);
    }
  };

  const handleSelect = (hit: ChunkSearchHit) => {
    onNavigate?.();
    onSelectResult?.(hit);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-border">
        <div className="relative">
          <Search className="absolute start-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!e.target.value.trim()) {
                setResults([]);
                setSearched(false);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch(query, rootMode);
            }}
            placeholder={t("library.search_books_placeholder", "Search imported books…")}
            className="h-8 text-xs ps-8"
          />
        </div>
        <button
          type="button"
          onClick={() => runSearch(query, rootMode)}
          className="mt-1.5 w-full rounded-md bg-primary/10 hover:bg-primary/15 text-primary text-xs font-medium py-1 transition-colors"
        >
          {searching ? t("common.searching", "Searching…") : t("common.search", "Search")}
        </button>
        <button
          type="button"
          onClick={() => {
            const next = !rootMode;
            setRootMode(next);
            if (next && query.trim()) runSearch(query, next);
          }}
          title={s2DbPath ? t("library.root_search_title_available", "Root search: match all morphological forms of the query's root") : t("library.root_search_title_unavailable", "Shamela S2.db not found — root search unavailable")}
          className={`mt-1 flex w-full items-center justify-center gap-1.5 rounded-md border py-1 text-xs font-medium transition-colors ${
            rootMode
              ? "border-primary/40 bg-primary/15 text-primary"
              : "border-border hover:bg-accent text-muted-foreground"
          } ${!s2DbPath ? "opacity-50" : ""}`}
        >
          <Languages className="h-3.5 w-3.5" />
          {t("library.root_search", "Root search")}
          {!s2DbPath && <span className="text-xs opacity-70">{t("library.root_off", "(off)")}</span>}
        </button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        {searching ? (
          <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("common.searching", "Searching…")}
          </div>
        ) : error ? (
          <p className="p-4 text-xs text-destructive">{error}</p>
        ) : results.length === 0 ? (
          searched ? (
            <EmptyState
              icon={FileText}
              title={t("library.no_results_title", "No results")}
              description={
                rootMode
                  ? t("library.root_no_results", "No results for any form of this root. Try a different word.")
                  : t("library.no_results", "No results. Try a different keyword.")
              }
            />
          ) : (
            <EmptyState
              icon={BookOpen}
              title={t("library.search_prompt_title", "Search every imported book")}
              description={t("library.search_prompt", "Type a keyword to search every imported book.")}
            />
          )
        ) : (
          <ul className="py-1">
            {results.map((hit, i) => (
              <li key={`${hit.itemId}-${hit.pageNumber}-${i}`}>
                <button
                  type="button"
                  onClick={() => handleSelect(hit)}
                  dir="rtl"
                  className="w-full text-end flex flex-col gap-1 px-3 py-2 border-b border-border/40 hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  <span className="flex items-center gap-1.5 text-xs font-medium leading-snug">
                    <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="truncate">{hit.title}</span>
                    {hit.pageNumber != null && (
                      <span className="text-xs text-muted-foreground tabular-nums shrink-0">{t("library.page_number", "p. {page}").replace("{page}", String(hit.pageNumber))}</span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                    {snippet(hit.content, stripHarakat(query))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
};

/** Build a readable snippet around the first match of the (harakat-stripped) query. */
function snippet(content: string, needle: string): string {
  const clean = content.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const lower = clean.toLowerCase();
  const idx = needle ? lower.indexOf(needle.toLowerCase()) : -1;
  if (idx === -1) return clean.slice(0, 140);
  const start = Math.max(0, idx - 60);
  const end = Math.min(clean.length, start + 140);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < clean.length ? "…" : "";
  return prefix + clean.slice(start, end) + suffix;
}
