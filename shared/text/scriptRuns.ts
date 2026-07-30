// Splits mixed text into runs by script, distinguishing URDU from ARABIC.
//
// WHY: Urdu and Arabic share the same Unicode block, so every existing
// "is this RTL?" check in the codebase treats them as one language. That is
// fine for choosing a text direction, but wrong for text-to-speech: an Urdu
// voice model mispronounces embedded Arabic, and scholarly Urdu prose is full
// of Arabic ayat and hadith. Piper's Urdu voice card says so explicitly —
// "Quality may vary on mixed-language input".
//
// The fix is to speak each run with its own voice. This module decides where
// the boundaries are. It is also useful for per-segment language hints to
// Whisper, and for bidi-aware rendering.
//
// Pure TypeScript — no runtime APIs. Loadable from Deno and Node alike.

export type ScriptKind = "urdu" | "arabic" | "latin" | "neutral";

export interface ScriptRun {
  kind: ScriptKind;
  text: string;
  /** Offset of the run's first character in the source string. */
  start: number;
  /** Offset one past the run's last character. */
  end: number;
}

// ── Character classes ───────────────────────────────────────────────────────

// The classes below are built from code points rather than written as literal
// characters. Two reasons: the Arabic presentation-forms range ends at U+FEFF,
// and a literal BOM inside a character class is invisible in review (it also
// trips `no-irregular-whitespace`); and a reviewer can check a range against
// the Unicode charts without having to identify glyphs by eye.

/** Build a character-class RegExp from inclusive [start, end] code-point pairs. */
function charClass(ranges: ReadonlyArray<readonly [number, number]>, flags = ""): RegExp {
  const body = ranges
    .map(([lo, hi]) =>
      lo === hi
        ? String.fromCodePoint(lo)
        : `${String.fromCodePoint(lo)}-${String.fromCodePoint(hi)}`,
    )
    .join("");
  return new RegExp(`[${body}]`, flags);
}

/** Build a character class from individual code points. */
function charSet(points: readonly number[], flags = ""): RegExp {
  return charClass(points.map((p) => [p, p] as const), flags);
}

const ARABIC = 0x0600, ARABIC_END = 0x06ff;
const ARABIC_SUP = 0x0750, ARABIC_SUP_END = 0x077f;
const ARABIC_EXT_A = 0x08a0, ARABIC_EXT_A_END = 0x08ff;
const PRES_A = 0xfb50, PRES_A_END = 0xfdff;
const PRES_B = 0xfe70, PRES_B_END = 0xfeff;

/**
 * Arabic script, including supplements and presentation forms.
 *
 * NOTE the two variants below are deliberately NOT the same. The two RTL
 * helpers at the bottom of this file used different ranges before they were
 * unified here, and M5.0 changes no behaviour:
 *   PRESENCE  (was textUtils)   included Arabic Extended-A (U+08A0-U+08FF)
 *   DOMINANCE (was arabicUtils) did not
 */
const ARABIC_SCRIPT = charClass([
  [ARABIC, ARABIC_END],
  [ARABIC_SUP, ARABIC_SUP_END],
  [ARABIC_EXT_A, ARABIC_EXT_A_END],
  [PRES_A, PRES_A_END],
  [PRES_B, PRES_B_END],
]);

const ARABIC_SCRIPT_DOMINANCE = charClass(
  [
    [ARABIC, ARABIC_END],
    [ARABIC_SUP, ARABIC_SUP_END],
    [PRES_A, PRES_A_END],
    [PRES_B, PRES_B_END],
  ],
  "g",
);

const LATIN_SCRIPT = charClass([
  [0x41, 0x5a],
  [0x61, 0x7a],
  [0x00c0, 0x024f],
]);

/**
 * Letters that exist in Urdu (and Persian) but NOT in the Arabic alphabet.
 * Any one of these is strong evidence the run is Urdu.
 *
 * Deliberately excludes آ (U+0622), ؤ (U+0624), and ئ (U+0626) — all three are
 * common in both languages and would produce false positives.
 */
const URDU_ONLY = charSet(
  [
    0x0679, // ٹ  tteh
    0x067e, // پ  peh
    0x0686, // چ  tcheh
    0x0688, // ڈ  ddal
    0x0691, // ڑ  rreh
    0x0698, // ژ  jeh
    0x06a9, // ک  keheh      (Arabic writes ك U+0643)
    0x06af, // گ  gaf
    0x06ba, // ں  noon ghunna
    0x06be, // ھ  heh doachashmee
    0x06c1, // ہ  heh goal
    0x06c3, // ۃ  teh marbuta goal
    0x06cc, // ی  farsi yeh   (Arabic writes ي U+064A)
    0x06d2, // ے  yeh barree
    0x06d3, // ۓ  yeh barree with hamza
  ],
  "g",
);

/**
 * Letters and marks that point to Arabic. Note that ك (U+0643) and ي (U+064A)
 * are the *Arabic* forms — Urdu writes those sounds as ک (U+06A9) and ی
 * (U+06CC), which is why the two sets are disjoint rather than overlapping.
 */
const ARABIC_ONLY = charSet(
  [
    0x0623, // أ  alef with hamza above
    0x0625, // إ  alef with hamza below
    0x0629, // ة  teh marbuta
    0x0643, // ك  arabic kaf   (Urdu writes ک U+06A9)
    0x064a, // ي  arabic yeh   (Urdu writes ی U+06CC)
    0x0649, // ى  alef maksura
  ],
  "g",
);

/** Tanween — grammatical case endings that essentially only occur in Arabic. */
const TANWEEN = charClass([[0x064b, 0x064d]], "g");

/** Harakat (fatha…sukun) plus the dagger alef, used as a density signal. */
const HARAKAT = charClass([[0x064b, 0x0652], [0x0670, 0x0670]], "g");

// ── Guillemets ──────────────────────────────────────────────────────────────

/**
 * The citation format from SPEC-v2 FR-1.4.1 wraps the Arabic passage in
 * guillemets: «arabic» — "translation" [reference]. Because we generate that
 * format ourselves, it is the most reliable Arabic signal available — more so
 * than any character heuristic. Content inside «…» is treated as Arabic
 * outright.
 */
const GUILLEMET_PAIR = /«([^»]*)»/g;

function countMatches(text: string, re: RegExp): number {
  // These regexes carry /g, so lastIndex must be reset between calls.
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(text) !== null) n++;
  re.lastIndex = 0;
  return n;
}

/**
 * Decide whether a run of Arabic-script text is Urdu or Arabic.
 *
 * Scoring, in order of confidence:
 *   1. Urdu-only letters   → +1 each
 *   2. Arabic-only letters → −1 each
 *   3. Tanween             → −2 each (near-conclusive for Arabic)
 *   4. Heavy harakat (>15% of characters) → −3 (fully vocalised religious text)
 *
 * `fallback` decides genuinely ambiguous runs — a two-letter word carrying no
 * markers at all. Defaults to Urdu because that is the app's primary authoring
 * language; pass "arabic" when the surrounding document is Arabic.
 */
export function classifyArabicScript(
  text: string,
  fallback: "urdu" | "arabic" = "urdu",
): "urdu" | "arabic" {
  const urduHits = countMatches(text, URDU_ONLY);
  const arabicHits = countMatches(text, ARABIC_ONLY);
  const tanweenHits = countMatches(text, TANWEEN);

  let score = urduHits - arabicHits - tanweenHits * 2;

  const letters = text.replace(/\s/g, "").length;
  if (letters > 0) {
    const harakatRatio = countMatches(text, HARAKAT) / letters;
    if (harakatRatio > 0.15) score -= 3;
  }

  if (score > 0) return "urdu";
  if (score < 0) return "arabic";
  return fallback;
}

function charKind(ch: string): "arabic-script" | "latin" | "neutral" {
  if (ARABIC_SCRIPT.test(ch)) return "arabic-script";
  if (LATIN_SCRIPT.test(ch)) return "latin";
  return "neutral";
}

interface RawRun {
  kind: "arabic-script" | "latin" | "neutral";
  start: number;
  end: number;
}

/** First pass: group characters into contiguous same-class spans. */
function rawRuns(text: string): RawRun[] {
  const runs: RawRun[] = [];
  for (let i = 0; i < text.length; i++) {
    const kind = charKind(text[i]);
    const last = runs[runs.length - 1];
    if (last && last.kind === kind) {
      last.end = i + 1;
    } else {
      runs.push({ kind, start: i, end: i + 1 });
    }
  }
  return runs;
}

/**
 * Fold neutral spans (spaces, punctuation, digits) into whichever side they
 * sit between when both sides agree. Without this, "کتاب Arabic کتاب" would
 * fragment into five runs instead of three, and the synthesised audio would
 * stutter at every space.
 */
function absorbNeutrals(runs: RawRun[]): RawRun[] {
  const out: RawRun[] = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (run.kind !== "neutral") {
      out.push({ ...run });
      continue;
    }
    const prev = out[out.length - 1];
    const next = runs[i + 1];
    if (prev && next && prev.kind === next.kind) {
      prev.end = run.end; // bridge: same script on both sides
    } else if (prev) {
      prev.end = run.end; // trailing punctuation belongs to what precedes it
    } else if (next) {
      next.start = run.start; // leading whitespace belongs to what follows
    } else {
      out.push({ ...run }); // the whole string is neutral
    }
  }
  return out;
}

function pushRun(out: ScriptRun[], kind: ScriptKind, text: string, start: number, end: number) {
  if (end <= start) return;
  const last = out[out.length - 1];
  if (last && last.kind === kind && last.end === start) {
    last.text += text.slice(start, end);
    last.end = end;
    return;
  }
  out.push({ kind, text: text.slice(start, end), start, end });
}

/**
 * Split text into script runs.
 *
 * Guillemet-wrapped spans are forced to "arabic" (see GUILLEMET_PAIR); the
 * remaining spans are classified by character evidence.
 *
 * @param fallback classification for Arabic-script runs carrying no markers
 */
export function splitScriptRuns(
  text: string,
  fallback: "urdu" | "arabic" = "urdu",
): ScriptRun[] {
  if (!text) return [];

  // Segments that the guillemet rule has already decided.
  const forcedArabic: Array<[number, number]> = [];
  GUILLEMET_PAIR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = GUILLEMET_PAIR.exec(text)) !== null) {
    forcedArabic.push([m.index, m.index + m[0].length]);
  }
  GUILLEMET_PAIR.lastIndex = 0;

  const isForced = (start: number, end: number) =>
    forcedArabic.some(([s, e]) => start >= s && end <= e);

  const out: ScriptRun[] = [];

  // Walk the text in segments split at guillemet boundaries so a quotation is
  // never merged with the Urdu prose around it.
  const boundaries = new Set<number>([0, text.length]);
  for (const [s, e] of forcedArabic) {
    boundaries.add(s);
    boundaries.add(e);
  }
  const cuts = [...boundaries].sort((a, b) => a - b);

  for (let c = 0; c < cuts.length - 1; c++) {
    const segStart = cuts[c];
    const segEnd = cuts[c + 1];
    const segment = text.slice(segStart, segEnd);

    if (isForced(segStart, segEnd)) {
      pushRun(out, "arabic", text, segStart, segEnd);
      continue;
    }

    for (const run of absorbNeutrals(rawRuns(segment))) {
      const start = segStart + run.start;
      const end = segStart + run.end;
      const slice = text.slice(start, end);

      let kind: ScriptKind;
      if (run.kind === "arabic-script") {
        kind = classifyArabicScript(slice, fallback);
      } else if (run.kind === "latin") {
        kind = "latin";
      } else {
        kind = "neutral";
      }
      pushRun(out, kind, text, start, end);
    }
  }

  return out;
}

// ── RTL detection ───────────────────────────────────────────────────────────
//
// Two different heuristics existed in the codebase under the same name
// `isRtlText` — src/utils/arabicUtils.ts and src/utils/textUtils.ts. They are
// NOT equivalent, and call sites depend on the difference:
//
//   arabicUtils: >30% of non-space characters are Arabic script  (dominance)
//   textUtils:   any Arabic-script character in the first 100    (presence)
//
// Both are kept, under names that say which is which. Neither behaviour
// changes; the accidental duplication simply becomes a documented choice.

/** True when Arabic-script characters DOMINATE (>30% of non-space chars). */
export function isRtlDominant(text: string): boolean {
  if (!text) return false;
  const alphanumeric = text.replace(/\s/g, "");
  if (alphanumeric.length === 0) return false;
  ARABIC_SCRIPT_DOMINANCE.lastIndex = 0;
  const arabicCount = (text.match(ARABIC_SCRIPT_DOMINANCE) ?? []).length;
  return arabicCount / alphanumeric.length > 0.3;
}

/** True when ANY Arabic-script character appears in the first 100 chars. */
export function hasRtlChars(text: string): boolean {
  if (!text) return false;
  return ARABIC_SCRIPT.test(text.slice(0, 100));
}
