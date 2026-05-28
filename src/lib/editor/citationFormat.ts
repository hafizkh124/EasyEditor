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
