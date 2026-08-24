import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import type { ResourceResult, CitationSearchResponse } from "@/lib/editor/citationFormat";
import { searchLocalShamela } from "@/lib/shamela/localShamelaService";
import { tafsirCall, fetchAyahText } from "@/lib/tafsir/tafsirService";
import {
  parseAyah, parseTafsirList, parseTafsirSearch, rowsFromTextBlocks,
  type TafsirRow,
} from "@/lib/tafsir/parseTafsir";
import { useTafsirAvailability } from "@/hooks/useTafsirAvailability";

export type SourceFilter = "all" | "quran" | "hadith" | "tafsir" | "shamela";

/** All Tafsir MCP content ships under this license (SPEC-TAFSIR §FR-7) —
 *  every row minted below carries it, matching what the old TafsirSearchDialog
 *  attached to every insert regardless of which tab produced the row. Kept as
 *  plain text through `citation_ref.url`: ResourceResultCard renders the
 *  citation as inert text, never as a link, so this reads as a parenthetical
 *  note the same way a real URL would. */
const TAFSIR_LICENSE_NOTE = "مرکز تفسیر، CC BY 4.0";

/** fetch_ayah → a Quran-bucketed row, so it sits with the rest of the Quran
 *  results rather than under the Tafsir chip (it's scripture, not commentary). */
function ayahRowToResult(row: TafsirRow, surah: number, ayah: number): ResourceResult {
  return {
    content: row.text,
    source_type: "quran",
    citation_ref: { surah_number: surah, verse: ayah, url: TAFSIR_LICENSE_NOTE },
    match_key: `tafsir-ayah-${surah}-${ayah}`,
  };
}

/** fetch_tafsir / search_in_tafsir → a Tafsir-bucketed commentary row. */
function tafsirRowToResult(row: TafsirRow, matchKey: string): ResourceResult {
  return {
    content: row.text,
    source_type: "tafsir",
    citation_ref: {
      title: [row.source, row.reference].filter(Boolean).join(" — ") || undefined,
      url: TAFSIR_LICENSE_NOTE,
    },
    match_key: matchKey,
  };
}

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

// Recognises "2:255"-shaped queries — a precise ayah lookup that a keyword
// search cannot express — so they route to fetch_ayah + fetch_tafsir instead
// of the free-text search_in_tafsir tool.
const SURAH_AYAH_RE = /^\s*(\d{1,3})\s*[:٬/]\s*(\d{1,3})\s*$/;

/** Same never-abort-the-siblings contract as `searchShamelaSafely`. */
async function searchTafsirSafely(
  query: string,
  tafsirSource: string,
): Promise<{ results: ResourceResult[]; error?: string }> {
  try {
    const surahAyah = SURAH_AYAH_RE.exec(query);
    if (surahAyah) {
      const surah = Number(surahAyah[1]);
      const ayah = Number(surahAyah[2]);
      const [ayahRes, tafsirRes] = await Promise.all([
        fetchAyahText(surah, ayah),
        tafsirCall("fetch_tafsir", { surah, ayah }),
      ]);
      const ayahRow = parseAyah({ text: ayahRes.text, structured: ayahRes.structured });
      let tafsirRows = parseTafsirList({ text: tafsirRes.text, structured: tafsirRes.structured });
      if (tafsirRows.length === 0) tafsirRows = rowsFromTextBlocks(tafsirRes.text);

      const results: ResourceResult[] = [];
      if (ayahRow.text) results.push(ayahRowToResult(ayahRow, surah, ayah));
      tafsirRows.forEach((row, i) => {
        const withRef = { ...row, reference: row.reference || `سورہ ${surah}:${ayah}` };
        results.push(tafsirRowToResult(withRef, `tafsir-list-${surah}-${ayah}-${i}`));
      });
      return { results };
    }

    const res = await tafsirCall("search_in_tafsir", {
      query,
      source: tafsirSource || undefined,
      limit: 20,
    });
    const rows = parseTafsirSearch({ text: res.text, structured: res.structured });
    return { results: rows.map((row, i) => tafsirRowToResult(row, `tafsir-search-${i}`)) };
  } catch (err) {
    return { results: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/** Which bucket a result belongs to, for the filter chips. `source_type` is
 *  the honest signal now that both Shamela (`localShamelaService.ts`) and
 *  Tafsir rows mint it correctly, and it is also what the cloud engine's own
 *  Tier-2 classical channel already sets for its `tafsir`-discipline rows
 *  (`scripts/classical_to_csv.py`'s `DISCIPLINE_SOURCE_TYPE`) — so this same
 *  check buckets those correctly too, not just this file's own rows. The
 *  match_key/reason checks stay only as a fallback for any older cloud rows
 *  that predate `source_type` carrying the real bucket. */
export function sourceTypeOf(r: ResourceResult): SourceFilter {
  if (r.source_type === "shamela") return "shamela";
  if (r.source_type === "tafsir") return "tafsir";
  if (r.match_key?.startsWith("shamela-") || r.reason?.includes("مکتبہ شاملہ")) return "shamela";
  if (r.match_key?.startsWith("tafsir-")) return "tafsir";
  return r.source_type === "quran" || r.citation_ref?.surah_number != null ? "quran" : "hadith";
}

/**
 * Reference lookup across the cloud corpus, the offline Shamela index, and
 * Tafsir MCP.
 *
 * All three are queried in parallel and any may come back empty: a cloud
 * failure still shows local/tafsir hits, and local-only results get their own
 * plan summary so the dialog can say where they came from. Split out of
 * `ResourceSearchDialog` for the 300-line limit (SPEC-M3 NFR-1).
 */
export function useResourceSearch(t: import("@/lib/i18n").Translator) {
  const { session } = useAuth();
  const { available: tafsirAvailable } = useTafsirAvailability();
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<CitationSearchResponse | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [filter, setFilter] = useState<SourceFilter>("all");
  const [tafsirSource, setTafsirSource] = useState("");

  const runSearch = useCallback(async () => {
    if (!query.trim()) return;
    const q = query.trim();
    setIsSearching(true);
    setSearched(true);
    setFilter("all");
    try {
      const [cloudRes, local, tafsir] = await Promise.all([
        session?.access_token
          ? fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/resource-search`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
                Authorization: `Bearer ${session.access_token}`,
              },
              body: JSON.stringify({ query: q }),
            }).catch(() => null)
          : Promise.resolve(null),
        searchShamelaSafely(q),
        // Unavailable users pay nothing for this leg — no network call, no error toast.
        tafsirAvailable
          ? searchTafsirSafely(q, tafsirSource)
          : Promise.resolve({ results: [] as ResourceResult[], error: undefined as string | undefined }),
      ]);

      const offlineResults = [...local.results, ...tafsir.results];

      // SPEC-M5.9 FR-3.5 / risk R15: the native route explains exactly why it
      // could not search — Shamela's JRE missing, the store index absent, the
      // library locked by a running Shamela. Showing zero results instead
      // would hide a fixable problem behind "nothing found".
      if (local.error) toast.error(local.error);
      if (tafsir.error) toast.error(tafsir.error);

      if (cloudRes && cloudRes.ok) {
        const data = (await cloudRes.json()) as CitationSearchResponse;
        if (offlineResults.length > 0) {
          data.results = [...(data.results || []), ...offlineResults];
        }
        setResponse(data);
      } else if (offlineResults.length > 0) {
        // Either offline leg (or both) may have produced these — name
        // whichever actually did, rather than a label naming only one.
        const scopeParts = [
          local.results.length > 0 ? t("editor.filter_shamela") : null,
          tafsir.results.length > 0 ? t("editor.filter_tafsir") : null,
        ].filter((p): p is string => p !== null);
        setResponse({
          intent: "topical",
          plan_summary: {
            arabic_terms: [q],
            scope_label: scopeParts.join(" + "),
            degraded: false,
          },
          results: offlineResults,
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
  }, [query, session, t, tafsirAvailable, tafsirSource]);

  // `?? []` mints a fresh array on every render while there is no response,
  // which made both memos below recompute every time.
  const results = useMemo(() => response?.results ?? [], [response]);

  const visibleResults = useMemo(
    () => (filter === "all" ? results : results.filter((r) => sourceTypeOf(r) === filter)),
    [results, filter],
  );

  const counts = useMemo(
    () => ({
      quran: results.filter((r) => sourceTypeOf(r) === "quran").length,
      hadith: results.filter((r) => sourceTypeOf(r) === "hadith").length,
      tafsir: results.filter((r) => sourceTypeOf(r) === "tafsir").length,
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
    tafsirAvailable,
    tafsirSource,
    setTafsirSource,
  };
}
