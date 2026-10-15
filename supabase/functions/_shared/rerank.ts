import { RRF_K } from "./rankFusion.ts";

export interface RerankOptions<T = unknown> {
  cohereApiKey?: string;
  maxResults?: number;
  timeoutMs?: number;
  model?: string;
  /**
   * Which retrieval source a row came from (e.g. the fan-out tier). Rows are
   * interleaved across groups before anything is cut — see `fuseByGroup`.
   * Without it every row is one group and the input order is kept.
   */
  groupOf?: (c: T) => string;
  /** How many fused candidates the cross-encoder scores. Default 40. */
  poolSize?: number;
  /**
   * When the caller returns a longer list but only the first `modelSlots`
   * reach the model, fusion and the anchor floor are computed for that prefix:
   * the head holds a fair cross-source mix and at least MIN_RETRIEVED_SLOTS
   * retrieved rows; overflow anchors/rows follow after it.
   */
  modelSlots?: number;
}

export interface CandidateWithScore {
  content: string;
  score?: number;
  rerank_score?: number;
  citation_ref?: {
    _is_anchor?: boolean;
    [key: string]: unknown;
  };
}

/** Never let pinned anchors crowd out every retrieved result. */
const MIN_RETRIEVED_SLOTS = 3;
const DEFAULT_POOL_SIZE = 40;

/**
 * Interleaves rows across groups by within-group rank — Reciprocal Rank Fusion
 * where each row lives in exactly one channel, so its score is 1/(K + rank in
 * its own group).
 *
 * Why this exists: `islamic-search` concatenates its tiers in a fixed order
 * (A, B, C, K, D, W, L, T). Taking the first N of that list means whichever
 * tiers happen to come first fill every slot, and the later ones — the user's
 * own library (L), word-by-word (W), the classical corpus (D), Turath (T) —
 * are cut no matter how relevant. Fusing by rank first gives each source that
 * actually returned something its best rows before any source gets its second.
 *
 * Deterministic: ties break by the group's first appearance, then by position.
 * Keeps each group's internal order (retrieval order = that source's ranking).
 */
export function fuseByGroup<T>(items: T[], groupOf: (c: T) => string): T[] {
  const groupIndex = new Map<string, number>();
  const scored: Array<{ item: T; score: number; g: number; pos: number }> = [];
  const seenPerGroup = new Map<string, number>();

  items.forEach((item, pos) => {
    const g = groupOf(item);
    if (!groupIndex.has(g)) groupIndex.set(g, groupIndex.size);
    const rank = (seenPerGroup.get(g) ?? 0) + 1;
    seenPerGroup.set(g, rank);
    scored.push({ item, score: 1 / (RRF_K + rank), g: groupIndex.get(g)!, pos });
  });

  scored.sort((a, b) => b.score - a.score || a.g - b.g || a.pos - b.pos);
  return scored.map((s) => s.item);
}

/**
 * Fuses and reranks candidates using Cohere Multilingual cross-encoder (ADR 0055).
 *
 * CRITICAL INVARIANTS:
 * 1. Score Preservation: `score` (RRF) is NEVER overwritten, preserving Kifayat Gate's calibrated threshold (0.03278).
 * 2. `rerank_score` records cross-encoder 0..1 relevance scores.
 * 3. Topic anchors (_is_anchor: true) are always pinned at the top and never dropped.
 * 4. Resilient fallback: times out strictly at 2.5s (2500ms) or falls back to RRF order on any failure.
 * 5. No source is starved: rows are fused across groups BEFORE the cut, both on
 *    the fallback path and as the pool handed to Cohere.
 */
export async function fuseAndRerank<T extends CandidateWithScore>(
  query: string,
  candidates: T[],
  options: RerankOptions<T> = {},
): Promise<T[]> {
  if (!candidates || candidates.length <= 1) {
    return candidates ?? [];
  }

  const maxResults = options.maxResults ?? 10;
  const timeoutMs = options.timeoutMs ?? 2500;
  const model = options.model ?? "rerank-v3.5";
  const poolSize = options.poolSize ?? DEFAULT_POOL_SIZE;
  const groupOf = options.groupOf ?? (() => "all");

  // Separate anchors from pool
  const anchors = candidates.filter((c) => c.citation_ref?._is_anchor === true);
  const rawPool = candidates.filter((c) => c.citation_ref?._is_anchor !== true);

  // The floor only matters when anchors exist: with maxResults=10 and 10+
  // anchors the old arithmetic left ZERO slots and dropped every retrieved
  // result. Without anchors maxResults is honoured exactly.
  const availableSlots = anchors.length > 0
    ? Math.max(MIN_RETRIEVED_SLOTS, maxResults - anchors.length)
    : maxResults;

  // Nothing to cut: keep the caller's order rather than reshuffling for no reason.
  const modelSlots = options.modelSlots;
  const headRetrieved = modelSlots === undefined ? availableSlots
    : anchors.length > 0 ? Math.max(MIN_RETRIEVED_SLOTS, modelSlots - anchors.length) : modelSlots;
  const headAnchors = modelSlots === undefined ? anchors.length : Math.max(0, modelSlots - headRetrieved);
  const assemble = (rows: T[]): T[] => {
    const kept = rows.slice(0, availableSlots);
    if (modelSlots === undefined) return [...anchors, ...kept];
    return [
      ...anchors.slice(0, headAnchors),
      ...kept.slice(0, headRetrieved),
      ...anchors.slice(headAnchors),
      ...kept.slice(headRetrieved),
    ];
  };
  const needsCut = rawPool.length > Math.min(availableSlots, headRetrieved);
  const fused = needsCut ? fuseByGroup(rawPool, groupOf) : rawPool;
  const fallback = () => assemble(fused);

  // If no Cohere key provided or no pool items, fall back immediately to fused RRF order
  if (!options.cohereApiKey || rawPool.length === 0) {
    return fallback();
  }

  // Cohere sees the fused head, not the raw tier-ordered head.
  const pool = fused.slice(0, poolSize);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const docs = pool.map((c) => (c.content || "").slice(0, 2000));

    const res = await fetch("https://api.cohere.com/v2/rerank", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.cohereApiKey.trim()}`,
      },
      body: JSON.stringify({
        model,
        query,
        documents: docs,
        top_n: Math.min(pool.length, availableSlots),
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn(`[rerank] Cohere returned HTTP ${res.status}: ${errText.slice(0, 150)}. Falling back to RRF.`);
      return fallback();
    }

    const json = await res.json();
    const results = json.results as Array<{ index: number; relevance_score: number }> | undefined;

    if (!Array.isArray(results) || results.length === 0) {
      return fallback();
    }

    const reranked: T[] = [];
    const usedIndices = new Set<number>();

    for (const r of results) {
      if (typeof r.index === "number" && r.index >= 0 && r.index < pool.length && !usedIndices.has(r.index)) {
        usedIndices.add(r.index);
        const orig = pool[r.index];
        reranked.push({
          ...orig,
          // Invariant: original `score` preserved for Kifayat Gate; rerank_score set
          rerank_score: typeof r.relevance_score === "number" ? r.relevance_score : undefined,
        });
      }
    }

    // Append any unranked pool items to preserve recall
    for (let i = 0; i < pool.length; i++) {
      if (!usedIndices.has(i)) {
        reranked.push(pool[i]);
      }
    }

    return assemble(reranked);
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[rerank] Cohere rerank call failed or timed out (${msg}). Falling back to RRF.`);
    return fallback();
  }
}
