/**
 * VerifyCitation — the fact-checking layer for scholarly citations.
 *
 * `RetrievalLedger` (grounding.ts) proves a footnote's source id was retrieved.
 * This proves the specifics a citation CLAIMS — book, volume, page, number,
 * chapter, and the scholar behind a grade — actually appear in what was
 * retrieved. Anything it cannot match is not "close enough": the caller shows
 * UNVERIFIED_DISCLAIMER_AR instead of the citation.
 *
 * Also enforces attributed grading: a grade counts only with a named scholar
 * taken from the source. Never our own verdict.
 *
 * Pure — no runtime globals (bundled into Electron main and the renderer).
 */
import { normalizeArabicForTakhrij } from '../text/takhrij.js';

/** "Could not verify in available primary sources". */
export const UNVERIFIED_DISCLAIMER_AR = 'لم أقف عليه في المصادر المتاحة';

/** Structured coordinates of a retrieved source — as the source itself states them. */
export interface SourceLocus {
  book?: string;
  volume?: string | number;
  page?: string | number;
  number?: string | number;
  chapter?: string;
  /** The named scholar who gave `grade` (المحدث) — absent ⇒ the grade is unattributed. */
  gradedBy?: string;
  grade?: string;
}

/** What a citation claims. Every field is optional; only given fields are checked. */
export type ClaimedCitation = SourceLocus;

export type CitationVerifyStatus = 'verified' | 'partial' | 'unverified';

export interface CitationVerifyResult {
  status: CitationVerifyStatus;
  matched: string[];
  mismatched: string[];
  /** The disclaimer, only when `status` is 'unverified'. */
  text?: string;
}

/** The part of a retrieved chunk verification needs (structurally a RetrievedChunk). */
export interface VerifiableSource {
  reference: string;
  content?: string;
  locus?: SourceLocus;
  grade?: string;
}

const FIELDS = ['book', 'volume', 'page', 'number', 'chapter', 'gradedBy', 'grade'] as const;
type Field = (typeof FIELDS)[number];
const NUMERIC: ReadonlySet<Field> = new Set(['volume', 'page', 'number']);

/** Arabic-Indic and Persian-Indic digits → ASCII. */
export function foldDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

function textKey(v: string | number): string {
  return normalizeArabicForTakhrij(foldDigits(String(v)))
    .replace(/[\s،,.:؛()«»"'-]+/g, ' ')
    .trim();
}

/** Whole-number tokens of a string (so "12" never matches inside "112"). */
function numbersIn(s: string): Set<string> {
  return new Set(foldDigits(s).match(/\d+/g) ?? []);
}

const present = (v: unknown): v is string | number =>
  v !== undefined && v !== null && String(v).trim() !== '';

/** Does `claimed` for one field appear in the source? */
function fieldMatches(field: Field, claimed: string | number, src: VerifiableSource): boolean {
  const own = src.locus?.[field];
  if (NUMERIC.has(field)) {
    const want = foldDigits(String(claimed)).trim();
    if (!/^\d+$/.test(want)) return false; // "ص ١٢-١٥" etc. is not a single verifiable number
    if (present(own)) return numbersIn(String(own)).has(want);
    return numbersIn(src.reference).has(want);
  }
  const want = textKey(claimed);
  if (!want) return false;
  if (present(own)) {
    const have = textKey(own);
    return have === want || have.includes(want);
  }
  // No structured locus for this field — look for it in the reference line
  // (and, for a grade/scholar, the source's own grade text).
  const hay = textKey(`${src.reference} ${field === 'grade' ? src.grade ?? '' : ''}`);
  return hay.includes(want);
}

/**
 * Check a claimed citation against one retrieved source.
 * - every claimed field matched → 'verified'
 * - some matched, some not → 'partial' (mismatched fields listed)
 * - none matched, nothing claimed, or no source → 'unverified'
 */
export function verifyCitation(
  claimed: ClaimedCitation,
  source: VerifiableSource | undefined | null,
): CitationVerifyResult {
  const given = FIELDS.filter((f) => present(claimed[f]));
  if (!source || given.length === 0) {
    return { status: 'unverified', matched: [], mismatched: given, text: UNVERIFIED_DISCLAIMER_AR };
  }
  const matched: string[] = [];
  const mismatched: string[] = [];
  for (const f of given) {
    (fieldMatches(f, claimed[f] as string | number, source) ? matched : mismatched).push(f);
  }
  if (mismatched.length === 0) return { status: 'verified', matched, mismatched };
  if (matched.length === 0) return { status: 'unverified', matched, mismatched, text: UNVERIFIED_DISCLAIMER_AR };
  return { status: 'partial', matched, mismatched };
}

/**
 * A grade is usable only when a named scholar stands behind it. Returns the
 * grade text, or null (the caller then shows the disclaimer / omits the grade).
 */
export function attributedGrade(g: { grade?: string; gradedBy?: string }): string | null {
  const grade = g.grade?.trim();
  const who = g.gradedBy?.trim();
  return grade && who ? grade : null;
}
