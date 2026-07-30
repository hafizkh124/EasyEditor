/**
 * Normalizes Arabic text for consistent embedding and search:
 * - Strips all harakat (short vowels / diacritics)
 * - Normalizes alef variants to bare alef (ا)
 * - Normalizes ta marbuta (ة) to ha (ه)
 * - Normalizes alef maqsura (ى) to ya (ي)
 *
 * Use before embedding queries in vector-search and during corpus ingestion.
 */
export function normalizeArabic(text: string): string {
  return text
    .replace(/[\u064B-\u065F\u0670]/g, "")           // strip all harakat + dagger alef
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627") // normalize alef variants → bare alef ا
    .replace(/\u0629/g, "\u0647")                     // ta marbuta ة → ha ه
    .replace(/\u0649/g, "\u064A")                     // alef maqsura ى → ya ي
    .trim();
}

/**
 * Removes all Arabic/Urdu diacritics (harakat / tashkeel) from text while
 * leaving the base letters and everything else untouched. Covers the standard
 * harakat block (fatha, kasra, damma, shadda, sukun, tanwin, etc.), the dagger
 * alef, and the Quranic annotation signs.
 *
 * Unlike normalizeArabic(), this does NOT fold alef/ta-marbuta/ya variants —
 * it is purely diacritic stripping for the editor "remove اعراب" action.
 */
export function stripHarakat(text: string): string {
  return text.replace(/[ً-ٰٟۖ-ۜ۟-۪ۨ-ۭ]/g, "");
}

/**
 * Returns true if a string is primarily RTL (Arabic/Urdu) text.
 * Simple heuristic: if >30% of word characters are Arabic/Urdu script.
 *
 * The implementation now lives in shared/ so Deno and Node see the same one.
 * Note this is the *dominance* test \u2014 src/utils/textUtils.ts exports a
 * same-named function that tests mere *presence*. The two are not
 * interchangeable; see the note in scriptRuns.ts.
 */
export { isRtlDominant as isRtlText } from "~shared/text/scriptRuns";
