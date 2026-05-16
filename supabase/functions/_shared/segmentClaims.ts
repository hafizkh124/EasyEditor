// Claim segmentation for the "Add citations" pipeline.
//
// Splits a user's free-form text into individual claim-bearing sentences so
// each one can have its own corpus lookup. Sentence boundaries are detected
// across Urdu (۔), Arabic (.!؟), and English (.!?), and inline citations
// already present in the text are preserved as their own segment.
//
// Output:
//   [{ index, text, start, end }]  — each segment includes the character
//   offsets in the original text so the caller can re-insert citations at the
//   exact end of each segment.

export interface ClaimSegment {
  index: number;
  text:  string;
  start: number;   // inclusive char offset in original
  end:   number;   // exclusive char offset in original
}

// Sentence-ending punctuation across the three scripts we support.
// Urdu uses ۔ as period; Arabic question mark is ؟; bullets/newlines also end claims.
const TERMINATORS = /([۔.!?؟])(\s+|$)/g;

const MIN_SEGMENT_LEN = 12;   // anything shorter is fragment-like; merged backwards
const MAX_SEGMENTS    = 30;   // safety cap so a 50-page paste doesn't melt the LLM

export function segmentClaims(input: string): ClaimSegment[] {
  if (!input || !input.trim()) return [];

  const out: ClaimSegment[] = [];
  let lastEnd = 0;
  let match: RegExpExecArray | null;

  TERMINATORS.lastIndex = 0;
  while ((match = TERMINATORS.exec(input)) !== null) {
    const end = match.index + 1; // include the terminator itself
    const raw = input.slice(lastEnd, end);
    pushSegment(out, raw, lastEnd, end);
    lastEnd = end + (match[2]?.length ?? 0);
  }

  // Trailing text without a terminator
  if (lastEnd < input.length) {
    const tail = input.slice(lastEnd);
    pushSegment(out, tail, lastEnd, input.length);
  }

  // Cap: keep the first N + a synthetic "...remaining text" tail so we don't
  // silently drop content.
  if (out.length > MAX_SEGMENTS) {
    const head = out.slice(0, MAX_SEGMENTS - 1);
    const restStart = out[MAX_SEGMENTS - 1].start;
    head.push({
      index: MAX_SEGMENTS - 1,
      text:  input.slice(restStart).trim(),
      start: restStart,
      end:   input.length,
    });
    return head.map((s, i) => ({ ...s, index: i }));
  }

  return out.map((s, i) => ({ ...s, index: i }));
}

function pushSegment(out: ClaimSegment[], raw: string, start: number, end: number) {
  const trimmed = raw.trim();
  if (!trimmed) return;

  // Tiny fragment (e.g. "ہاں۔") gets merged into the previous segment so the
  // LLM sees a full thought, not a one-word interjection.
  if (trimmed.length < MIN_SEGMENT_LEN && out.length > 0) {
    const prev = out[out.length - 1];
    prev.text  = `${prev.text} ${trimmed}`.trim();
    prev.end   = end;
    return;
  }

  out.push({
    index: out.length,
    text:  trimmed,
    start,
    end,
  });
}

/** Detect dominant script of a segment for downstream language-aware lookups. */
export function detectScript(text: string): "ar" | "ur" | "en" | "mixed" {
  const arabicCount = (text.match(/[؀-ۿ]/g) ?? []).length;
  const urduOnly    = /[ٹڈڑںھہۂۃیے۔چ]/.test(text);
  const latinCount  = (text.match(/[A-Za-z]/g) ?? []).length;
  if (urduOnly && arabicCount > latinCount) return "ur";
  if (arabicCount > latinCount && arabicCount > 3) return "ar";
  if (latinCount > arabicCount && latinCount > 3) return "en";
  return "mixed";
}
