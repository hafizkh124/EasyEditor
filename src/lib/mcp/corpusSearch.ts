// Lexical corpus search for the MCP tools.
//
// Talks to the SAME RPC the app's Tier K uses — `search_documents_smart` — with
// its real parameter names. The first version of these tools called it with
// `{ patterns, sub_patterns, max_results }`; the function is
// `(p_terms, p_source_types, p_match_limit)`, so PostgREST rejected every call
// ("could not find the function … in the schema cache") and both tools failed
// on every request. Their tests only checked metadata and the unauthenticated
// refusal, so nothing noticed. mcpTools.test.ts now pins these names against the
// migration that defines the function.

export const SEARCH_RPC = "search_documents_smart";

/** scholarly_documents.source_type values (see scripts/classical_to_csv.py). */
export type CorpusDomain = "all" | "quran" | "hadith" | "fatwa" | "classical";

/** `null` = no source_type filter (everything in the corpus). */
export function sourceTypesFor(domain: CorpusDomain): string[] | null {
  switch (domain) {
    case "quran": return ["quran"];
    case "hadith": return ["hadith"];
    case "fatwa": return ["fatwa"];
    case "classical": return ["classical", "tafsir"];
    default: return null;
  }
}

const QUERY_STOPWORDS = new Set([
  "في", "من", "على", "الى", "إلى", "عن", "مع", "هذا", "هذه", "ذلك", "التي", "الذي",
  "ما", "هل", "كيف", "متى", "ان", "أن", "إن", "او", "أو", "ثم", "قد", "لا",
]);

/**
 * Splits a free-text query into search terms.
 *
 * The RPC matches each term as a normalized SUBSTRING and ranks by how many
 * distinct terms a row matched. Passing the whole sentence as one term would
 * only ever match a row containing that exact sentence, so a multi-word query
 * returned nothing.
 */
export function queryTerms(query: string, max = 8): string[] {
  const out: string[] = [];
  for (const raw of query.split(/[\s،.:؛؟?!()«»"'\-–—,;]+/)) {
    const t = raw.trim();
    if (t.length < 3 || QUERY_STOPWORDS.has(t) || out.includes(t)) continue;
    out.push(t);
    if (out.length >= max) break;
  }
  // A very short query ("نور") or all-stopword query still deserves a search.
  if (out.length === 0) {
    const whole = query.trim();
    if (whole.length >= 2) out.push(whole);
  }
  return out;
}

export interface CorpusRow {
  id: string;
  domain: string;
  source_type: string;
  content: string | null;
  content_ar: string | null;
  citation_ref: Record<string, unknown> | null;
  language: string | null;
  source_url: string | null;
  match_score: number;
}

// Deliberately structural: the real client is a SupabaseClient, tests pass a fake.
export interface RpcClient {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export async function searchCorpus(
  supabase: RpcClient,
  opts: { terms: string[]; sourceTypes: string[] | null; limit: number },
): Promise<{ rows: CorpusRow[]; error?: string }> {
  if (opts.terms.length === 0) return { rows: [] };
  const { data, error } = await supabase.rpc(SEARCH_RPC, {
    p_terms: opts.terms,
    p_source_types: opts.sourceTypes,
    p_match_limit: opts.limit,
  });
  if (error) return { rows: [], error: error.message };
  return { rows: (Array.isArray(data) ? data : []) as CorpusRow[] };
}
