/**
 * Arabic/Urdu normalization for the FTS5 keyword-search index (SPEC-M6 Phase 5).
 *
 * Lives in shared/ so both the main process (electron/db/schema.ts backfill,
 * electron/db/ingest.ts storeChunk, electron/db/workspaceStore/search.ts) and
 * any future cloud-side code apply the exact same transform to index and query.
 *
 * Mirrors src/utils/arabicUtils.ts's normalizeArabic: strip harakat, fold
 * alef variants to bare alef, ta marbuta to ha, alef maqsura to ya. Unlike
 * the renderer copy this file avoids importing React-tree utils; the two are
 * kept in sync by a mirror test (see src/test/arabicSearchMirror.test.ts).
 */
export function normalizeArabicForSearch(text: string): string {
  return text
    .replace(/[\u064B-\u065F\u0670]/g, "")           // strip all harakat + dagger alef
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627") // normalize alef variants → bare alef ا
    .replace(/\u0629/g, "\u0647")                     // ta marbuta ة → ha ه
    .replace(/\u0649/g, "\u064A")                     // alef maqsura ى → ya ي
    .trim();
}
