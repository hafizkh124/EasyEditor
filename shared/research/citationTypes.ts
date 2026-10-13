/**
 * Source-precise citation shape shared by the renderer research UI and the
 * Electron main process (M9 defect #3).
 *
 * `islamic-search`'s `sources_ready` event carries these — collection, hadith
 * number, grade, rāwī, volume, page — which is exactly what the agent's
 * retrieval ledger needs to make a hadith or tafsir result citable. The type
 * lived in `src/components/research/CitationPanel.tsx`; moving it to `shared/`
 * lets `electron/agent/researchBridge.ts` import it without crossing the
 * purity boundary (`npm run check:shared`).
 *
 * Pure — no runtime globals.
 */

export interface ScholarlyCitationRef {
  book?: string;
  collection?: string;
  hadith_number?: string | number;
  grade?: string;
  rawi?: string;
  surah_number?: number;
  surah_name?: string;
  surah_name_en?: string;
  verse?: number;
  juz?: number;
  fatwa_number?: string;
  scholar?: string;
  url?: string;
  volume?: number;
  page?: number;
  author?: string;
  title?: string;
  type?: string;
  /** Other corpora that carried the same hadith, joined into this one result. */
  also_in?: string[];
}

export interface CitationItem {
  domain: string;
  citation_ref: ScholarlyCitationRef;
  url?: string;
  /**
   * The retrieved passage itself (truncated server-side), so the reader can
   * see and copy the actual text — not just a reference label. Optional: the
   * agent's tool-call citations and older persisted sessions don't carry it.
   */
  content?: string;
  /** Arabic matn, when the retrieved row has it separately from `content`
   *  (whose text is often the Urdu translation). Shown first in the panel. */
  content_ar?: string;
}

/**
 * A one-line human reference for a scholarly citation — collection + number +
 * grade for hadith, book + volume/page for classical works, surah:ayah for
 * Qur'an. Used to build the agent's footnote text (M9 Phase 1). Returns null
 * when the ref carries nothing citable (the caller then drops the chunk).
 */
export function formatScholarlyRef(ref: ScholarlyCitationRef, domain?: string): string | null {
  const parts: string[] = [];
  let matched = true;

  if (ref.collection || ref.book) {
    const work = ref.collection ?? ref.book!;
    const num = ref.hadith_number != null ? ` ${ref.hadith_number}` : '';
    parts.push(`${work}${num}`.trim());
    if (ref.rawi) parts.push(`عن ${ref.rawi}`);
    if (ref.grade) parts.push(`(${ref.grade})`);
  } else if (ref.surah_name || ref.surah_number != null) {
    const s = ref.surah_name ?? `سورة ${ref.surah_number}`;
    parts.push(ref.verse != null ? `${s}: ${ref.verse}` : s);
    if (ref.juz != null) parts.push(`جزء ${ref.juz}`);
  } else if (ref.fatwa_number || ref.scholar) {
    if (ref.scholar) parts.push(ref.scholar);
    if (ref.fatwa_number) parts.push(`فتوى رقم ${ref.fatwa_number}`);
  } else if (ref.title || ref.author) {
    if (ref.author) parts.push(ref.author);
    if (ref.title) parts.push(`«${ref.title}»`);
    if (ref.volume != null) parts.push(`ج${ref.volume}`);
    if (ref.page != null) parts.push(`ص${ref.page}`);
    // A bare title/author with no locus is weaker — tag its origin.
    matched = ref.volume != null || ref.page != null;
  } else {
    return null;
  }

  if (parts.length === 0) return null;
  const out = parts.join('، ');
  return !matched && domain ? `${out} [${domain}]` : out;
}
