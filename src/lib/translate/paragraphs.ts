/**
 * Paragraph pairs for translation review (SYSTEM-2026 §6): the source and its
 * translation are read side by side one paragraph at a time. The source is
 * normalised into paragraphs before it is sent, and the model is told to keep
 * the same paragraphs, so the two usually line up one to one. When they do not,
 * callers fall back to reviewing the page as a whole.
 */

/** A line that ends a sentence (Urdu ۔ ؟, Arabic ؟ ؛, Latin), allowing closing quotes/brackets. */
const SENTENCE_END_LINE = /[۔؟!?.:؛;][»"”’)\]]*\s*$/;

function normalise(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

/**
 * Split text into paragraphs. Blank lines separate paragraphs; when there are
 * none (OCR of a scanned page gives one line per printed line), lines are
 * joined until one ends a sentence.
 */
export function splitParagraphs(text: string): string[] {
  const t = normalise(text);
  if (!t) return [];
  const blocks = t.split(/\n[ \t]*\n+/).map((s) => s.trim()).filter(Boolean);
  if (blocks.length > 1) return blocks;
  const lines = t.split("\n").map((s) => s.trim()).filter(Boolean);
  if (lines.length <= 1) return lines;
  const out: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    current.push(line);
    if (SENTENCE_END_LINE.test(line)) {
      out.push(current.join(" "));
      current = [];
    }
  }
  if (current.length) out.push(current.join(" "));
  return out;
}

export function joinParagraphs(paragraphs: readonly string[]): string {
  return paragraphs.map((p) => p.trim()).join("\n\n");
}

/**
 * The translation as paragraphs matching `source` one to one, or null when the
 * counts differ. A translation that came back with single line breaks instead
 * of blank lines still lines up.
 */
export function alignParagraphs(source: readonly string[], translation: string): string[] | null {
  if (source.length === 0) return null;
  const t = normalise(translation);
  if (!t) return null;
  const blocks = t.split(/\n[ \t]*\n+/).map((s) => s.trim()).filter(Boolean);
  if (blocks.length === source.length) return blocks;
  const lines = t.split("\n").map((s) => s.trim()).filter(Boolean);
  if (lines.length === source.length) return lines;
  return null;
}

/** The translation with paragraph `index` replaced, or null when it does not line up with the source. */
export function replaceParagraph(
  source: readonly string[],
  translation: string,
  index: number,
  text: string,
): string | null {
  const aligned = alignParagraphs(source, translation);
  if (!aligned || index < 0 || index >= aligned.length) return null;
  const next = [...aligned];
  next[index] = text.trim();
  return joinParagraphs(next);
}

export interface ParagraphPair {
  source: string;
  translation: string;
}

/**
 * A page as review pairs. `aligned` is false when the translation does not
 * line up paragraph by paragraph (or the page was translated from its image
 * with no text) — then the page is one pair, reviewed as a whole.
 */
export function pairParagraphs(sourceText: string | undefined, translationText: string): { pairs: ParagraphPair[]; aligned: boolean } {
  const source = splitParagraphs(sourceText ?? "");
  if (!translationText.trim()) {
    return { pairs: source.map((s) => ({ source: s, translation: "" })), aligned: true };
  }
  const aligned = alignParagraphs(source, translationText);
  if (aligned) return { pairs: source.map((s, i) => ({ source: s, translation: aligned[i] })), aligned: true };
  return { pairs: [{ source: source.join("\n\n"), translation: translationText.trim() }], aligned: false };
}
