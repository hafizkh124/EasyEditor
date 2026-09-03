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
}

export interface CitationItem {
  domain: string;
  citation_ref: ScholarlyCitationRef;
  url?: string;
}
