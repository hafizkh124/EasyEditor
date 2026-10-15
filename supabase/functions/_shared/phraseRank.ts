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
import { bookIdOf, foldArabic } from "./witnessGroups.ts";

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
  if (!query) return null;
  // Not `looksArabic`: that needs 15+ letters to tell a long passage from Urdu, which
  // would reject the short phrases people actually type ("لا ضرر ولا ضرار", 13 letters).
  // A query is Arabic when it has a handful of Arabic letters and next to no Urdu-only ones.
  const letters = (query.match(/[ء-يٱ-ۓ]/g) ?? []).length;
  if (letters < 6) return null;
  const urduOnly = (query.match(/[ٹڈڑںےپچژگھہۂ]/g) ?? []).length;
  if (urduOnly / letters >= 0.02) return null;
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

/**
 * Adds the WHOLE phrase as the first lexical search term.
 *
 * The lexical RPCs take an arbitrary 600 candidates per term (LIMIT, no ORDER),
 * so for a phrase like "من كذب علي متعمدا" the common single words ("كذب") fill
 * their candidate sets with rows that merely contain them, and the canonical
 * Bukhari/Muslim narrations may not be among them at all (seen live, 2026-10-14:
 * none of the Six Books' exact-phrase rows reached the ranked list). The phrase
 * itself is rare, so ITS candidates are the rows that really contain it — and a
 * row that matches it also scores higher in the RPC's match_score.
 *
 * First position so a later `slice(0, N)` cap never cuts it. Non-phrase queries
 * pass through unchanged.
 */
export function withPhraseTerm(terms: string[], query: string | null | undefined): string[] {
  const phrase = phraseOf(query);
  if (!phrase) return terms;
  const raw = (query ?? "").trim().replace(/\s+/g, " ");
  return [raw, ...terms.filter((t) => t !== raw)];
}
