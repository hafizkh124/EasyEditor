// Cross-tier result identity for islamic-search.
//
// Six tiers fan out concurrently and their rows are concatenated into one
// list. Several of them read the SAME table: Tier B (pgvector) and Tier K
// (lexical) both search scholarly_documents, and Tier D (classical, semantic)
// overlaps Tier K on fatwa rows. Nothing de-duplicated them, so one hadith
// could be handed to the model — and shown in the citation panel — two or
// three times, each occurrence eating one of the answer's source slots.
//
// Lives in _shared/ rather than inside islamic-search/index.ts so it can be
// unit-tested: that module calls serve() at import time and cannot be loaded
// from a test.

/** The subset of IslamicResult this module needs. Structural, so the real
 *  IslamicResult from islamic-api-fetch satisfies it without an import (that
 *  module also calls serve() at load). */
export interface IdentifiableResult {
  citation_ref?: {
    book?: string;
    collection?: string;
    hadith_number?: string | number;
    surah_number?: number;
    verse?: number;
    url?: string;
    [key: string]: unknown;
  };
}

/**
 * A stable cross-tier identity for a retrieved passage, or `null`.
 *
 * Returning `null` is the important half of this contract: it means "this row
 * has no identity I trust", and the caller must then KEEP the row. The
 * alternative — inventing a key from whatever fields happen to be present —
 * is how a de-duplicator silently deletes real results. The ad-hoc key that
 * used to guard the topic-anchor merge had exactly that flaw: it read
 * `${surah_number}:${verse}|${book}:${hadith_number}`, which is `":|:"` for
 * every fatwa and classical row, so reusing it for a global dedupe would have
 * collapsed all 22,775 fatwa rulings into one.
 *
 * Deliberately NOT merged: the same hadith arriving from a live API and from
 * the local corpus. Dorar reports `book: "صحيح البخاري"` while the corpus
 * stores `collection: "bukhari"`, so they produce different keys and both
 * survive — which is correct. They are different witnesses with their own
 * wording and grading, and collapsing them would hide a source the scholar
 * asked for rather than remove a duplicate.
 */
export function resultIdentity(r: IdentifiableResult): string | null {
  const c = r.citation_ref ?? {};

  // Quran: surah + ayah is a complete, corpus-independent identity.
  if (c.surah_number != null && c.verse != null) {
    const surah = Number(c.surah_number);
    const verse = Number(c.verse);
    if (Number.isFinite(surah) && Number.isFinite(verse)) {
      return `quran:${surah}:${verse}`;
    }
  }

  // Hadith: a book AND a number. Either alone is not an identity — "bukhari"
  // with no number would merge every unnumbered Bukhari row into one.
  const book = c.collection ?? c.book;
  const num = c.hadith_number;
  if (
    typeof book === "string" && book.trim() !== "" &&
    num != null && String(num).trim() !== ""
  ) {
    return `hadith:${book.trim().toLowerCase()}:${String(num).trim()}`;
  }

  // Fatwa and classical rows carry neither. Their canonical URL is the stable
  // per-ruling identity — urdufatwa writes one on every row, and it is the
  // same string whether the row came back from Tier K or Tier D.
  if (typeof c.url === "string" && c.url.trim() !== "") {
    return `url:${c.url.trim()}`;
  }

  // No trustworthy identity — the caller keeps the row.
  return null;
}

/** De-duplicate while preserving order, keeping the FIRST occurrence of each
 *  identity. Rows whose identity is `null` are always kept. */
export function dedupeResults<T extends IdentifiableResult>(results: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of results) {
    const id = resultIdentity(r);
    if (id === null) { out.push(r); continue; }
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
}
