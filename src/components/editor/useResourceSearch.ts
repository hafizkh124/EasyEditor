import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import type { ResourceResult, CitationSearchResponse } from "@/lib/editor/citationFormat";
import { searchLocalShamela } from "@/lib/shamela/localShamelaService";

export type SourceFilter = "all" | "quran" | "hadith" | "shamela";

/**
 * Runs the Shamela lookup without letting a failure abort the cloud lookup
 * beside it in Promise.all — but keeps the reason, so the caller can show it
 * rather than a bare "search failed".
 */
async function searchShamelaSafely(
  query: string,
): Promise<{ results: ResourceResult[]; error?: string }> {
  try {
    return { results: await searchLocalShamela(query) };
  } catch (err) {
    return { results: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/** Which bucket a result belongs to, for the filter chips. */
function sourceTypeOf(r: ResourceResult): SourceFilter {
  if (r.match_key?.startsWith("shamela-") || r.reason?.includes("مکتبہ شاملہ")) {
    return "shamela";
  }
  return r.source_type === "quran" || r.citation_ref?.surah_number != null ? "quran" : "hadith";
}

/**
 * Reference lookup across the cloud corpus and the offline Shamela index.
 *
 * Both are queried in parallel and either may come back empty: a cloud failure
 * still shows local hits, and local-only results get their own plan summary so
 * the dialog can say where they came from. Split out of `ResourceSearchDialog`
 * for the 300-line limit (SPEC-M3 NFR-1).
 */
export function useResourceSearch(t: import("@/lib/i18n").Translator) {
  const { session } = useAuth();
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<CitationSearchResponse | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [filter, setFilter] = useState<SourceFilter>("all");

  const runSearch = useCallback(async () => {
    if (!query.trim()) return;
    setIsSearching(true);
    setSearched(true);
    setFilter("all");
    try {
      const [cloudRes, local] = await Promise.all([
        session?.access_token
          ? fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/resource-search`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
                Authorization: `Bearer ${session.access_token}`,
              },
              body: JSON.stringify({ query }),
            }).catch(() => null)
          : Promise.resolve(null),
        searchShamelaSafely(query.trim()),
      ]);

      const localResults = local.results;

      // SPEC-M5.9 FR-3.5 / risk R15: the native route explains exactly why it
      // could not search — Shamela's JRE missing, the store index absent, the
      // library locked by a running Shamela. Showing zero results instead
      // would hide a fixable problem behind "nothing found".
      if (local.error) toast.error(local.error);

      if (cloudRes && cloudRes.ok) {
        const data = (await cloudRes.json()) as CitationSearchResponse;
        if (localResults.length > 0) {
          data.results = [...(data.results || []), ...localResults];
        }
        setResponse(data);
      } else if (localResults.length > 0) {
        setResponse({
          intent: "topical",
          plan_summary: {
            arabic_terms: [query.trim()],
            scope_label: "مکتبہ شاملہ (آف لائن)",
            degraded: false,
          },
          results: localResults,
        });
      } else {
        if (cloudRes && !cloudRes.ok) {
          const err = await cloudRes.json().catch(() => ({}));
          toast.error(err.error || t("editor.search_error"));
        } else {
          toast.error(t("editor.search_error"));
        }
        setResponse(null);
      }
    } catch {
      toast.error(t("editor.search_error"));
      setResponse(null);
    } finally {
      setIsSearching(false);
    }
  }, [query, session, t]);

  const results = response?.results ?? [];

  const visibleResults = useMemo(
    () => (filter === "all" ? results : results.filter((r) => sourceTypeOf(r) === filter)),
    [results, filter],
  );

  const counts = useMemo(
    () => ({
      quran: results.filter((r) => sourceTypeOf(r) === "quran").length,
      hadith: results.filter((r) => sourceTypeOf(r) === "hadith").length,
      shamela: results.filter((r) => sourceTypeOf(r) === "shamela").length,
    }),
    [results],
  );

  return {
    query,
    setQuery,
    runSearch,
    isSearching,
    searched,
    response,
    results,
    visibleResults,
    counts,
    filter,
    setFilter,
  };
}
