// AUTO-MIRRORED from shared/search/rankFusion.ts — edge deploy bundles only supabase/functions/.
// Edit shared/search/rankFusion.ts and re-run: node scripts/mirror-shared.mjs
// Reciprocal Rank Fusion (RRF) for combining the citation engine's retrieval
// channels (lexical over content_ar, semantic over pgvector).
//
// Why RRF rather than score normalization: the two channels produce
// incomparable scores — the lexical channel returns "how many query terms
// matched" (a small integer), the semantic channel returns cosine similarity
// (0..1). Normalizing them against each other needs a weight nobody can tune
// honestly. RRF only looks at each document's RANK within its own channel, so
// no cross-channel calibration is needed, and a channel returning nothing
// (e.g. semantic search when the embedding backfill is incomplete) simply
// contributes nothing instead of skewing the result.
//
// score(doc) = Σ_channels 1 / (K + rank_in_channel)   [rank is 1-based]
//
// K=60 is the constant from the original RRF paper (Cormack et al. 2009) and
// the de-facto default in hybrid search implementations. It damps the gap
// between the top few ranks so one channel can't dominate on its #1 alone.
//
// This file lives in shared/ (SPEC-M5 FR-1.5) so the Deno citation engine
// (supabase/functions/_shared/rankFusion.ts, a thin re-export) and the
// Electron local-mode search path read the exact same fusion logic.

export const RRF_K = 60;

export interface FusableDoc {
  /** Stable identity across channels: "quran:2:255" | "hadith:bukhari:1".
   *  Same key shape used by citationCandidates.ts / citationVerifier.ts. */
  match_key: string;
  // Deliberately `any`, not `unknown`: callers pass sealed interfaces like
  // EngineCitation, which have no index signature of their own. An
  // `unknown`-indexed FusableDoc rejects those at the call site in
  // citationEngine.ts even though every field access inside this file is
  // narrow and safe (match_key only).
  // deno-lint-ignore no-explicit-any
  [k: string]: any;
}

export interface FusedDoc<T extends FusableDoc = FusableDoc> {
  doc: T;
  score: number;
  /** Which channels surfaced this doc — useful for debugging and for showing
   *  "matched on wording" vs "matched on meaning" in the UI. */
  channels: string[];
}

/**
 * Fuse ranked lists into one ranked list.
 *
 * @param channels Named channels, each already ordered best-first. Empty
 *                 channels are allowed and contribute nothing.
 * @param k        RRF damping constant. Defaults to RRF_K (60).
 *
 * Documents are deduplicated by `match_key`. When the same document appears in
 * several channels, the FIRST channel's object is kept (channels should be
 * passed in order of metadata richness) and the scores add up — appearing in
 * both channels is exactly the signal RRF is designed to reward.
 */
export function reciprocalRankFusion<T extends FusableDoc>(
  channels: Array<{ name: string; docs: T[] }>,
  k: number = RRF_K,
): Array<FusedDoc<T>> {
  const merged = new Map<string, FusedDoc<T>>();

  for (const channel of channels) {
    if (!channel?.docs?.length) continue;

    let rank = 0;
    const seenInChannel = new Set<string>();

    for (const doc of channel.docs) {
      const key = doc?.match_key;
      if (!key) continue;
      // Guard against a channel returning the same doc twice — it must not
      // collect the reciprocal bonus more than once from one channel.
      if (seenInChannel.has(key)) continue;
      seenInChannel.add(key);

      rank += 1;
      const contribution = 1 / (k + rank);

      const existing = merged.get(key);
      if (existing) {
        existing.score += contribution;
        existing.channels.push(channel.name);
      } else {
        merged.set(key, { doc, score: contribution, channels: [channel.name] });
      }
    }
  }

  return [...merged.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Deterministic tie-break so identical inputs always produce identical
    // output ordering (matters for caching and for stable test assertions).
    return a.doc.match_key.localeCompare(b.doc.match_key);
  });
}

/** Build the canonical match_key for a scholarly_documents row. Returns null
 *  when the row lacks the identifying fields (such rows can't be deduped or
 *  verified, so the engine drops them). */
export function buildMatchKey(row: Record<string, unknown>): string | null {
  const cite = (row?.citation_ref as Record<string, unknown>) ?? {};
  const sourceType = row?.source_type as string;

  if (sourceType === "quran") {
    const surah = cite.surah_number ?? cite.surah;
    const verse = cite.verse;
    if (surah == null || verse == null) return null;
    return `quran:${surah}:${verse}`;
  }

  if (sourceType === "hadith") {
    const book = cite.collection ?? cite.book;
    const number = cite.hadith_number;
    if (!book || number == null) return null;
    return `hadith:${book}:${number}`;
  }

  // Tier-2 classical corpus (fiqh / fatwa / tafsir / lughat / rijal / nahw).
  // Prefer the row's own passage_key when the RPC returned it; otherwise build
  // a stable key from the book + location, and fall back to the row id so a
  // real passage is never dropped for lack of an identity.
  if (typeof row?.passage_key === "string" && row.passage_key) {
    return row.passage_key as string;
  }
  const bookId = cite.book_id ?? cite.openiti_id ?? cite.shamela_id;
  if (bookId != null && (cite.page != null || cite.volume != null)) {
    return `${sourceType}:${bookId}:${cite.volume ?? 0}:${cite.page ?? 0}`;
  }
  if (row?.id != null) return `doc:${row.id}`;

  return null;
}
