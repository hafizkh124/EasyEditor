/**
 * Formats a scholarly_documents `citation_ref` object into a human-readable
 * reference line. Mirrors the shape used server-side in refine-text and
 * vector-search. Handles hadith, Quran, and generic (book/scholar) sources.
 */
export interface CitationRef {
  book?: string;
  collection?: string;
  hadith_number?: string | number;
  grade?: string;
  rawi?: string;
  surah_number?: number;
  surah_name?: string;
  verse?: number;
  juz?: number;
  fatwa_number?: string | number;
  scholar?: string;
  url?: string;
  volume?: number;
  page?: number;
  title?: string;
}

export interface ResourceResult {
  content: string;
  citation_ref: CitationRef;
  source_url?: string | null;
  domain?: string;
  language?: string;
  /** Fields below are added by the shared citation engine
   *  (supabase/functions/_shared/citationEngine.ts). All optional so older
   *  callers and stored results keep type-checking. */
  match_key?: string;
  content_ar?: string;
  source_type?: string;
  score?: number;
  /** Which retrieval channels found this row ("lexical" / "semantic"). */
  channels?: string[];
  /** One-line relevance note, present only when the rerank pass ran. */
  reason?: string;
}

/** Per-surah (Quran) or per-collection (Hadith) breakdown of a count query. */
export interface CitationCountBucket {
  key: string;
  label: string;
  source_type: string;
  occurrences: number;
  rows_matched: number;
}

/** Full response shape of the `resource-search` edge function. */
export interface CitationSearchResponse {
  intent: "topical" | "count" | "reference" | "phrase";
  plan_summary: {
    arabic_terms: string[];
    scope_label: string;
    /** True when the query plan came from the keyword fallback, not the model. */
    degraded: boolean;
  };
  results: ResourceResult[];
  count?: {
    total: number;
    rows_matched: number;
    buckets: CitationCountBucket[];
    caveats: string[];
  };
}

/** Build a short citation label, e.g. "Sahih Bukhari #123 (sahih)" or "Quran Al-Baqarah 2:255". */
export function formatCitation(cite: CitationRef, sourceUrl?: string | null): string {
  let ref = "";

  if (cite.collection || cite.book) {
    const base = cite.collection ?? cite.book ?? "";
    const num = cite.hadith_number ? ` #${cite.hadith_number}` : "";
    const grade = cite.grade ? ` (${cite.grade})` : "";
    ref = `${base}${num}${grade}`;
  } else if (cite.surah_name || cite.surah_number) {
    const name = cite.surah_name ?? `Surah ${cite.surah_number ?? ""}`;
    const loc = cite.verse ? ` ${cite.surah_number ?? ""}:${cite.verse}` : "";
    ref = `Quran ${name}${loc}`.trim();
  } else if (cite.scholar || cite.fatwa_number) {
    ref = [cite.scholar, cite.fatwa_number ? `Fatwa #${cite.fatwa_number}` : ""]
      .filter(Boolean).join(" — ");
  } else {
    ref = cite.title ?? "Reference";
  }

  if (cite.volume || cite.page) {
    const vp = [cite.volume ? `vol. ${cite.volume}` : "", cite.page ? `p. ${cite.page}` : ""]
      .filter(Boolean).join(", ");
    if (vp) ref += `, ${vp}`;
  }

  const url = sourceUrl ?? cite.url;
  return url ? `${ref} (${url})` : ref;
}

/**
 * Rebuilds the "حوالہ جات / Sources" section of a citations-task result from
 * the model's [N] index markers plus the verified `sources` array the task
 * run returned — instead of trusting whatever reference text the model
 * typed. See buildIslamicCitationsPrompt in supabase/functions/refine-text
 * for the prompt contract this depends on: the model lists only bracketed
 * source numbers under that heading, never a hand-typed reference.
 *
 * Falls back to returning `resultText` unchanged if the heading or any [N]
 * markers are missing — an older cached result, or a model that ignored the
 * instruction, still displays rather than silently losing its content.
 */
export function rebuildCitedRefinement(
  resultText: string,
  sources: Array<{ reference: string; source_url?: string | null }>,
): string {
  if (sources.length === 0) return resultText;

  const headingRe = /\n#{1,4}[^\n]*(?:حوالہ جات|Sources|References)[^\n]*\n/i;
  const match = headingRe.exec(resultText);
  if (!match) return resultText;

  const before = resultText.slice(0, match.index + match[0].length);
  const after = resultText.slice(match.index + match[0].length);

  const indices = [...after.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  if (indices.length === 0) return resultText;

  const lines = indices
    .filter((n) => n >= 1 && n <= sources.length)
    .map((n, i) => {
      const s = sources[n - 1];
      return s.source_url ? `${i + 1}. [${s.reference}](${s.source_url})` : `${i + 1}. ${s.reference}`;
    });
  if (lines.length === 0) return resultText;

  return `${before}${lines.join("\n")}\n`;
}
