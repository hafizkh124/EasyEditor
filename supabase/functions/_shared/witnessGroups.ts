/**
 * Groups the SAME hadith arriving from different corpora into one result.
 *
 * Live check (2026-10-13, Q5 "كلمتان خفيفتان على اللسان"): the ten sources held
 * `bukhari #6406` (corpus row, Urdu translation) and `صحيح البخاري #6406` (live
 * API row, Arabic) as two entries — and `صحيح ابن حبان #841` next to
 * `تخريج صحيح ابن حبان #841` — so ten slots carried five or six hadith.
 * `resultIdentity` deliberately keeps these apart: they are different
 * witnesses with their own wording and grading. That is still right, so this
 * does not DELETE anything; it joins the witnesses into one card, keeping both
 * texts and both labels.
 *
 * Conservative by construction, because a wrong merge hides a real source:
 *   - a book and a number must both be recognised (book names are resolved
 *     through the corpus registry, so "bukhari" and "صحيح البخاري" meet);
 *   - and the two rows must BOTH carry Arabic text that actually overlaps.
 *     Hadith numbering differs between editions, so equal numbers alone prove
 *     nothing; a row with no Arabic to compare is never merged.
 */
import { CORPUS_BOOKS } from "./collections.ts";

const TASHKEEL = /[ً-ْٰـ]/g;
const URDU_ONLY = /[ٹڈڑںےپچژگھہۂ]/g;
const ARABIC_LETTER = /[ء-يٱ-ۓ]/g;

/** Same folding the corpus search uses: no harakat, one alef, ه for ة, ي for ى. */
export function foldArabic(s: string): string {
  return (s ?? "")
    .replace(TASHKEEL, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^ء-يٱ-ۓ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Arabic (not Urdu) text: Arabic letters dominate and Urdu-only letters are rare. */
export function looksArabic(s: string | undefined | null): boolean {
  if (!s) return false;
  const letters = (s.match(ARABIC_LETTER) ?? []).length;
  if (letters < 15) return false;
  const urdu = (s.match(URDU_ONLY) ?? []).length;
  return urdu / letters < 0.02;
}

let ALIASES: Map<string, string> | null = null;
function aliases(): Map<string, string> {
  if (ALIASES) return ALIASES;
  ALIASES = new Map();
  for (const b of CORPUS_BOOKS) {
    for (const name of [b.id, b.ar, b.ur, ...b.slugs]) {
      const k = foldArabic(name).toLowerCase() || name.toLowerCase();
      if (k && !ALIASES.has(k)) ALIASES.set(k, b.id);
      const raw = name.trim().toLowerCase();
      if (raw && !ALIASES.has(raw)) ALIASES.set(raw, b.id);
    }
  }
  return ALIASES;
}

/** Canonical corpus book id for a stored collection / displayed book name, or null. */
export function bookIdOf(name: unknown): string | null {
  if (typeof name !== "string" || name.trim() === "") return null;
  const m = aliases();
  return m.get(foldArabic(name).toLowerCase()) ?? m.get(name.trim().toLowerCase()) ?? null;
}

export interface WitnessRow {
  domain: string;
  content: string;
  content_ar?: string;
  citation_ref: { book?: string; collection?: string; hadith_number?: string | number; grade?: string; [k: string]: unknown };
}

function arabicOf(r: WitnessRow): string {
  if (r.content_ar && looksArabic(r.content_ar)) return r.content_ar;
  return looksArabic(r.content) ? r.content : "";
}

function words(s: string): Set<string> {
  return new Set(foldArabic(s).split(" ").filter((w) => w.length > 2));
}

/** Share of the SMALLER word set found in the other (one row may carry the isnad, the other only the matn). */
export function arabicOverlap(a: string, b: string): number {
  const A = words(a), B = words(b);
  if (A.size < 4 || B.size < 4) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return common / Math.min(A.size, B.size);
}

export const MIN_OVERLAP = 0.6;

function locus(r: WitnessRow): string | null {
  const c = r.citation_ref ?? {};
  const id = bookIdOf(c.collection) ?? bookIdOf(c.book);
  const num = c.hadith_number;
  if (!id || num == null || String(num).trim() === "") return null;
  return `${id}:${String(num).trim()}`;
}

/**
 * Merges witnesses of one hadith into the FIRST row of each group (mutated in
 * place so identity-keyed side tables, such as the tier map used by rerank,
 * stay valid) and returns the list without the absorbed rows.
 */
export function groupWitnesses<T extends WitnessRow>(rows: T[]): T[] {
  const primaries = new Map<string, T[]>(); // locus -> hosts already seen
  const absorbed = new Set<T>();

  for (const row of rows) {
    const key = locus(row);
    const ar = key ? arabicOf(row) : "";
    if (!key || !ar) continue;
    const seen = primaries.get(key) ?? [];
    const host = seen.find((p) => p.domain !== row.domain && arabicOverlap(arabicOf(p), ar) >= MIN_OVERLAP);
    if (!host) { seen.push(row); primaries.set(key, seen); continue; }

    // Join: Arabic matn from whichever has more, translation from the row whose
    // `content` is not Arabic, grade from either, and a note of who witnessed it.
    const hostAr = arabicOf(host);
    const translation = !looksArabic(host.content) && host.content ? host.content
      : (!looksArabic(row.content) && row.content ? row.content : "");
    host.content_ar = hostAr.length >= ar.length ? hostAr : ar;
    if (translation) host.content = translation;
    if (!host.citation_ref.grade && row.citation_ref.grade) host.citation_ref.grade = row.citation_ref.grade;
    const prior = Array.isArray(host.citation_ref.also_in) ? (host.citation_ref.also_in as string[]) : [];
    host.citation_ref.also_in = [...new Set([...prior, row.citation_ref.book ?? row.citation_ref.collection ?? row.domain])] as string[];
    absorbed.add(row);
  }
  return absorbed.size === 0 ? rows : rows.filter((r) => !absorbed.has(r));
}
