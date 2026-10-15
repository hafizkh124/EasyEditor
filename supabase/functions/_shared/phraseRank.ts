/**
 * Puts exact-phrase hits first when the user typed an Arabic phrase.
 *
 * Live check (2026-10-13, "كلمتان خفيفتان على اللسان"): Sahih Muslim 2694, one
 * of the best-known narrations of that exact wording, sat at position 13 while
 * the ten slots the model reads went to silsilah-sahihah and kanz-ul-ummal. The
 * fan-out interleaves tiers by rank and knows nothing about "this row contains
 * the whole phrase" or "this is one of the Six Books".
 *
 * Deliberately narrow:
 *   - only for an Arabic query of 2+ words (an Urdu topical question has no
 *     phrase to match);
 *   - three buckets, each in its ORIGINAL relative order: phrase hit in a Six
 *     Books row, phrase hit elsewhere, everything else;
 *   - it reorders, never drops, so no source disappears;
 *   - pinned topic anchors stay where they are (first).
 */
import { bookIdOf, foldArabic, looksArabic } from "./witnessGroups.ts";

export const SIX_BOOKS: ReadonlySet<string> = new Set([
  "bukhari", "muslim", "abudawud", "tirmidhi", "nasai", "ibnmajah",
]);

export interface PhraseRow {
  domain: string;
  content: string;
  content_ar?: string;
  citation_ref: { book?: string; collection?: string; _is_anchor?: boolean; [k: string]: unknown };
}

/** The query folded for matching, or null when it is not an Arabic phrase worth matching. */
export function phraseOf(query: string | null | undefined): string | null {
  if (!query || !looksArabic(query)) return null;
  const folded = foldArabic(query);
  return folded.split(" ").filter((w) => w.length > 1).length >= 2 ? folded : null;
}

function hasPhrase(r: PhraseRow, phrase: string): boolean {
  const texts = [r.content_ar, r.content];
  return texts.some((t) => typeof t === "string" && t !== "" && foldArabic(t).includes(phrase));
}

function isSixBooks(r: PhraseRow): boolean {
  const id = bookIdOf(r.citation_ref?.collection) ?? bookIdOf(r.citation_ref?.book);
  return id !== null && SIX_BOOKS.has(id);
}

export function prioritizePhraseHits<T extends PhraseRow>(rows: T[], query: string | null | undefined): T[] {
  const phrase = phraseOf(query);
  if (!phrase || rows.length < 2) return rows;

  const anchors: T[] = [], six: T[] = [], other: T[] = [], rest: T[] = [];
  for (const r of rows) {
    if (r.citation_ref?._is_anchor === true) anchors.push(r);
    else if (!hasPhrase(r, phrase)) rest.push(r);
    else if (isSixBooks(r)) six.push(r);
    else other.push(r);
  }
  if (six.length === 0 && other.length === 0) return rows;
  return [...anchors, ...six, ...other, ...rest];
}
