/**
 * Runs the lexical corpus RPCs (`search_documents_smart` / `_scoped`) as a few
 * small parallel calls instead of one big serial one.
 *
 * Live diagnosis (2026-10-13, docs/eval/tierk-diagnose.sql results): the RPC
 * builds one UNION ALL branch per term (two per term for `smart`) and Postgres
 * executes them one after another. A single branch is ~0.35s even when the
 * trigram index is used correctly — the index scan is 22ms, the rest is
 * re-checking ~600 candidate rows with a 5-step `regexp_replace` over long
 * Arabic text. Nine terms therefore cost 4.8s, twelve 7-14s. The index is
 * present and valid; the cost is the number of branches, not a missing index.
 *
 * Splitting the term list across up to MAX_CHUNKS concurrent calls turns a sum
 * into (roughly) a max. Scores are additive across chunks because
 * `match_score` is "how many of the supplied terms matched this row" and each
 * term lives in exactly one chunk.
 */

export interface ScoredRow {
  id: string;
  match_score?: number | null;
}

export interface RpcResult<T> {
  data: T[] | null;
  error: { code?: string; message?: string } | null;
}

export const MAX_CHUNKS = 4;
/** Below this many terms a single call is already cheap; splitting only adds overhead. */
export const MIN_TERMS_TO_SPLIT = 4;

/** Contiguous, balanced slices: 10 terms, 4 chunks -> 3,3,2,2. */
export function chunkTerms<T>(terms: readonly T[], maxChunks = MAX_CHUNKS): T[][] {
  if (terms.length < MIN_TERMS_TO_SPLIT) return terms.length ? [[...terms]] : [];
  const n = Math.min(maxChunks, terms.length);
  const out: T[][] = [];
  let start = 0;
  for (let i = 0; i < n; i++) {
    const size = Math.ceil((terms.length - start) / (n - i));
    out.push(terms.slice(start, start + size));
    start += size;
  }
  return out;
}

/** Sums match_score per id across chunks, orders like the RPC does (score DESC, id), cuts to `limit`. */
export function mergeScoredRows<T extends ScoredRow>(chunks: ReadonlyArray<ReadonlyArray<T>>, limit: number): T[] {
  const byId = new Map<string, T & { match_score: number }>();
  for (const rows of chunks) {
    for (const row of rows) {
      const prev = byId.get(row.id);
      const score = Number(row.match_score) || 0;
      if (prev) prev.match_score += score;
      else byId.set(row.id, { ...row, match_score: score });
    }
  }
  return [...byId.values()]
    .sort((a, b) => b.match_score - a.match_score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, limit);
}

/**
 * `call(termsForThisChunk)` performs one RPC. An error in some chunks degrades
 * to the rows the others returned; the error is surfaced only when EVERY chunk
 * failed (so the caller's "RPC failed" handling still means what it did).
 */
export async function searchInChunks<T extends ScoredRow>(
  terms: readonly string[],
  limit: number,
  call: (chunkTerms: string[], chunkLimit: number) => PromiseLike<RpcResult<T>>,
): Promise<RpcResult<T> & { chunks: number }> {
  const parts = chunkTerms(terms);
  if (parts.length === 0) return { data: [], error: null, chunks: 0 };
  if (parts.length === 1) return { ...(await call(parts[0], limit)), chunks: 1 };

  // A row can rank high by matching one term in every chunk, so each chunk
  // returns more than `limit` rows before the merge cuts back down.
  const chunkLimit = limit * 2;
  const results = await Promise.all(parts.map((p) => call(p, chunkLimit)));
  const ok = results.filter((r) => !r.error && r.data);
  if (ok.length === 0) return { data: null, error: results[0].error, chunks: parts.length };
  return { data: mergeScoredRows(ok.map((r) => r.data as T[]), limit), error: null, chunks: parts.length };
}
