export interface RerankOptions {
  cohereApiKey?: string;
  maxResults?: number;
  timeoutMs?: number;
  model?: string;
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

/**
 * Fuses and reranks candidates using Cohere Multilingual cross-encoder (ADR 0055).
 *
 * CRITICAL INVARIANTS:
 * 1. Score Preservation: `score` (RRF) is NEVER overwritten, preserving Kifayat Gate's calibrated threshold (0.03278).
 * 2. `rerank_score` records cross-encoder 0..1 relevance scores.
 * 3. Topic anchors (_is_anchor: true) are always pinned at the top and never dropped.
 * 4. Resilient fallback: times out strictly at 2.5s (2500ms) or falls back to RRF order on any failure.
 */
export async function fuseAndRerank<T extends CandidateWithScore>(
  query: string,
  candidates: T[],
  options: RerankOptions = {},
): Promise<T[]> {
  if (!candidates || candidates.length <= 1) {
    return candidates ?? [];
  }

  const maxResults = options.maxResults ?? 10;
  const timeoutMs = options.timeoutMs ?? 2500;
  const model = options.model ?? "rerank-v3.5";

  // Separate anchors from pool
  const anchors = candidates.filter((c) => c.citation_ref?._is_anchor === true);
  const pool = candidates.filter((c) => c.citation_ref?._is_anchor !== true);

  const availableSlots = Math.max(0, maxResults - anchors.length);

  // If no Cohere key provided or no pool items, fallback immediately to RRF order
  if (!options.cohereApiKey || pool.length === 0 || availableSlots === 0) {
    return [...anchors, ...pool.slice(0, availableSlots)];
  }

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
      return [...anchors, ...pool.slice(0, availableSlots)];
    }

    const json = await res.json();
    const results = json.results as Array<{ index: number; relevance_score: number }> | undefined;

    if (!Array.isArray(results) || results.length === 0) {
      return [...anchors, ...pool.slice(0, availableSlots)];
    }

    const reranked: T[] = [];
    const usedIndices = new Set<number>();

    for (const r of results) {
      if (typeof r.index === "number" && r.index >= 0 && r.index < pool.length) {
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

    return [...anchors, ...reranked.slice(0, availableSlots)];
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[rerank] Cohere rerank call failed or timed out (${msg}). Falling back to RRF.`);
    return [...anchors, ...pool.slice(0, availableSlots)];
  }
}
