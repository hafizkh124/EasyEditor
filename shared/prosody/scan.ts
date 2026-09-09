/**
 * Connectors Hub (Phase 7, ADR-0042) — a rule-based taqṭīʿ (scansion) engine
 * for Urdu / Persian verse.
 *
 * HEURISTIC by nature. Urdu script omits most short vowels, so from the written
 * form alone we cannot always tell an open syllable (CV, short) from a closed
 * one (CVC, long). This makes a deterministic best guess: a consonant + a long
 * vowel letter (ا و ی ے, or آ) is a long syllable; a word-final consonant
 * closes the syllable before it (long); a lone consonant otherwise is a short
 * syllable with an assumed helping vowel. It then compares the long/short
 * pattern against a small table of the common buḥūr, allowing the final foot to
 * vary (زحاف / علت). A clean match → `confidence: 'high'`; otherwise `bahr` is
 * null and `confidence: 'low'`.
 *
 * The output is ALWAYS a machine reading to be checked — never a verdict, and a
 * baḥr is never a fact. `note` says so on every result.
 *
 * Pure — no runtime globals.
 */

export interface Syllable {
  text: string;
  /** 2 = long (سبب/وتد مغلق, "="), 1 = short ("−"). */
  weight: 1 | 2;
}

export interface LineScan {
  input: string;
  syllables: Syllable[];
  /** The weight string, e.g. "= − = = | = − = = | …". */
  pattern: string;
  /** Best-effort arkān names (فعولن …), or [] when the pattern did not match. */
  feet: string[];
  bahr: string | null;
  confidence: 'high' | 'low';
  note: string;
}

export interface ProsodyScan {
  lines: LineScan[];
  note: string;
}

const HEURISTIC_NOTE =
  'Machine reading — verify against a metre chart. The baḥr is a best guess, not a fact.';

// Long-vowel bearers (a preceding consonant + one of these = a long syllable).
const LONG_VOWEL = new Set(['ا', 'آ', 'و', 'ی', 'ي', 'ے', 'ى']);

// Anything that is not an Arabic-script letter is a word boundary.
const LETTER = /\p{Script=Arabic}/u;

/**
 * Strip harakat, superscript alef, tatweel, ZWNJ/ZWJ and the Qur'anic
 * annotation marks — by codepoint, because a regex character class of
 * combining marks trips eslint's `no-misleading-character-class`.
 */
function stripMarks(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    const isMark =
      (cp >= 0x0610 && cp <= 0x061a) ||
      (cp >= 0x064b && cp <= 0x065f) ||
      cp === 0x0670 || cp === 0x0640 ||
      cp === 0x200c || cp === 0x200d ||
      (cp >= 0x06d6 && cp <= 0x06ed);
    if (!isMark) out += ch;
  }
  return out;
}

function normalise(line: string): string {
  return stripMarks(line)
    .replace(/[أإآ]/g, 'ا')
    .replace(/[ۃة]/g, 'ت')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ی')
    .trim();
}

/** Split a normalised line into prosodic syllables (heuristic). */
export function syllabify(line: string): Syllable[] {
  const out: Syllable[] = [];
  const words = normalise(line).split(/\s+/).filter(Boolean);

  for (const word of words) {
    const chars = [...word].filter((c) => LETTER.test(c));
    let i = 0;
    let buf = '';
    while (i < chars.length) {
      const c = chars[i];
      const next = chars[i + 1];
      buf += c;

      const startsWithAlif = i === 0 && (c === 'ا' || c === 'آ');
      // A long vowel letter right after a consonant closes a long syllable.
      if (next && LONG_VOWEL.has(next) && !startsWithAlif) {
        out.push({ text: buf + next, weight: 2 });
        buf = '';
        i += 2;
        continue;
      }
      // آ on its own is inherently long.
      if (c === 'آ') {
        out.push({ text: buf, weight: 2 });
        buf = '';
        i += 1;
        continue;
      }
      // Word-final consonant → closes the previous syllable (make it long), or,
      // if there is none, stands as a heavy syllable of its own.
      if (i === chars.length - 1) {
        if (out.length && buf.length === 1 && !LONG_VOWEL.has(c)) {
          out[out.length - 1] = { text: out[out.length - 1].text + buf, weight: 2 };
        } else {
          out.push({ text: buf, weight: buf.length > 1 || LONG_VOWEL.has(c) ? 2 : 1 });
        }
        buf = '';
        i += 1;
        continue;
      }
      // A lone consonant with an assumed short helping vowel.
      out.push({ text: buf, weight: LONG_VOWEL.has(c) ? 2 : 1 });
      buf = '';
      i += 1;
    }
    if (buf) out.push({ text: buf, weight: 1 });
  }
  return out;
}

// The common Urdu/Persian buḥūr, as (foot-name → weight-pattern), 2 = long,
// 1 = short. The final foot is matched loosely (see `matchBahr`).
const FEET: Record<string, number[]> = {
  'فعولن': [1, 2, 2],
  'مفاعیلن': [1, 2, 2, 2],
  'فاعلاتن': [2, 1, 2, 2],
  'مستفعلن': [2, 2, 1, 2],
  'متفاعلن': [1, 1, 2, 1, 2],
  'فاعلن': [2, 1, 2],
  'مفعولن': [2, 2, 2],
};

const BUHUR: Array<{ name: string; feet: string[] }> = [
  { name: 'متقارب', feet: ['فعولن', 'فعولن', 'فعولن', 'فعولن'] },
  { name: 'هزج', feet: ['مفاعیلن', 'مفاعیلن', 'مفاعیلن', 'مفاعیلن'] },
  { name: 'رمل', feet: ['فاعلاتن', 'فاعلاتن', 'فاعلاتن', 'فاعلن'] },
  { name: 'رجز', feet: ['مستفعلن', 'مستفعلن', 'مستفعلن', 'مستفعلن'] },
  { name: 'کامل', feet: ['متفاعلن', 'متفاعلن', 'متفاعلن', 'متفاعلن'] },
  { name: 'خفیف', feet: ['فاعلاتن', 'مستفعلن', 'فاعلاتن'] },
  { name: 'مضارع', feet: ['مفاعیلن', 'فاعلاتن', 'مفاعیلن', 'فاعلاتن'] },
];

function patternOf(feet: string[]): number[] {
  return feet.flatMap((f) => FEET[f] ?? []);
}

function sameSeq(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Compare the line's weight sequence with each baḥr, tolerating the last foot. */
function matchBahr(weights: number[]): { name: string; feet: string[] } | null {
  for (const b of BUHUR) {
    const full = patternOf(b.feet);
    if (sameSeq(full, weights)) return b;
    const lastLen = FEET[b.feet[b.feet.length - 1]]?.length ?? 0;
    const head = full.slice(0, full.length - lastLen);
    if (
      head.length > 0 &&
      weights.length >= head.length &&
      weights.length <= full.length + 1 &&
      sameSeq(head, weights.slice(0, head.length))
    ) {
      return b;
    }
  }
  return null;
}

function groupPattern(weights: number[]): string {
  return weights.map((w) => (w === 2 ? '=' : '−')).join(' ');
}

export function scanLine(line: string): LineScan {
  const input = line.trim();
  const syllables = syllabify(input);
  const weights = syllables.map((s) => s.weight);
  const pattern = groupPattern(weights);

  if (syllables.length === 0) {
    return { input, syllables, pattern: '', feet: [], bahr: null, confidence: 'low', note: HEURISTIC_NOTE };
  }

  const hit = matchBahr(weights);
  return {
    input,
    syllables,
    pattern,
    feet: hit?.feet ?? [],
    bahr: hit?.name ?? null,
    confidence: hit ? 'high' : 'low',
    note: HEURISTIC_NOTE,
  };
}

export function scanProsody(text: string): ProsodyScan {
  const lines = text
    .split(/\r?\n|،|؛|\|/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, 12)
    .map(scanLine);
  return {
    lines: lines.length ? lines : [scanLine(text)],
    note: HEURISTIC_NOTE,
  };
}
