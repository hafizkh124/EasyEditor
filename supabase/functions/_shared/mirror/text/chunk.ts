// AUTO-MIRRORED from shared/text/chunk.ts — edge deploy bundles only supabase/functions/.
// Edit shared/text/chunk.ts and re-run: npm run mirror:shared (scripts/mirror-shared.mjs).
// Sentence/claim segmentation, shared by the "Add citations" pipeline (Deno,
// via supabase/functions/_shared/segmentClaims.ts's re-export) and any local
// equivalent in Electron main (SPEC-M5 FR-1.5/FR-3.4).
//
// Splits free-form text into individual claim-bearing sentences so each one
// can have its own corpus lookup. Sentence boundaries are detected across
// Urdu (۔), Arabic (.!؟), and English (.!?).
//
// Output: [{ index, text, start, end }] — each segment includes the
// character offsets in the original text so the caller can re-insert
// citations at the exact end of each segment.

export interface TextSegment {
  index: number;
  text: string;
  start: number; // inclusive char offset in original
  end: number;   // exclusive char offset in original
}

// Sentence-ending punctuation across the three scripts we support.
// Urdu uses ۔ as period; Arabic question mark is ؟; bullets/newlines also end claims.
const TERMINATORS = /([۔.!?؟])(\s+|$)/g;

const MIN_SEGMENT_LEN = 12; // anything shorter is fragment-like; merged backwards
const MAX_SEGMENTS = 30;    // safety cap so a 50-page paste doesn't melt the LLM

export function segmentText(input: string): TextSegment[] {
  if (!input || !input.trim()) return [];

  const out: TextSegment[] = [];
  let lastEnd = 0;
  let match: RegExpExecArray | null;

  TERMINATORS.lastIndex = 0;
  while ((match = TERMINATORS.exec(input)) !== null) {
    const end = match.index + 1;
    const raw = input.slice(lastEnd, end);
    pushSegment(out, raw, lastEnd, end);
    lastEnd = end + (match[2]?.length ?? 0);
  }

  if (lastEnd < input.length) {
    const tail = input.slice(lastEnd);
    pushSegment(out, tail, lastEnd, input.length);
  }

  if (out.length > MAX_SEGMENTS) {
    const head = out.slice(0, MAX_SEGMENTS - 1);
    const restStart = out[MAX_SEGMENTS - 1].start;
    head.push({
      index: MAX_SEGMENTS - 1,
      text: input.slice(restStart).trim(),
      start: restStart,
      end: input.length,
    });
    return head.map((s, i) => ({ ...s, index: i }));
  }

  return out.map((s, i) => ({ ...s, index: i }));
}

function pushSegment(out: TextSegment[], raw: string, start: number, end: number) {
  const trimmed = raw.trim();
  if (!trimmed) return;

  if (trimmed.length < MIN_SEGMENT_LEN && out.length > 0) {
    const prev = out[out.length - 1];
    prev.text = `${prev.text} ${trimmed}`.trim();
    prev.end = end;
    return;
  }

  out.push({
    index: out.length,
    text: trimmed,
    start,
    end,
  });
}

export function splitIntoChunks(text: string, maxChars: number = 8000): string[] {
  if (!text) return [];
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  const sentences = segmentText(text);
  let current = "";

  for (const seg of sentences) {
    if ((current + " " + seg.text).length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = seg.text;
    } else {
      current = current ? `${current} ${seg.text}` : seg.text;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

export function estimateChunks(text: string, maxChars: number = 8000): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / maxChars));
}
