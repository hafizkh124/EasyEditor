/**
 * Low-confidence words in OCR text (SYSTEM-2026 §5). The OCR service marks
 * what it could not read with certainty as `[?]` (process-ocr's rule 5),
 * usually right after the word; here those words are found so the result can
 * show them in yellow next to the page image.
 */

export interface TextRun {
  text: string;
  uncertain: boolean;
}

/** A word followed by the marker, or a bare marker standing for an unreadable word. */
const MARK = /(\S+?)?[ \t]*\[\?\]/g;

export function splitUncertain(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let last = 0;
  for (const m of text.matchAll(MARK)) {
    const at = m.index ?? 0;
    if (at > last) runs.push({ text: text.slice(last, at), uncertain: false });
    runs.push({ text: m[1] ?? "؟", uncertain: true });
    last = at + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), uncertain: false });
  return runs;
}

export function countUncertain(text: string): number {
  return text.match(/\[\?\]/g)?.length ?? 0;
}

/**
 * A multi-page result split back into its pages, by the `--- صفحہ N ---`
 * markers the engine writes between them (any label, so an English or Arabic
 * UI's markers split too). Without markers the whole text is page 1.
 */
export function splitPages(text: string): Array<{ pageNum: number; text: string }> {
  const marker = /^---[ \t]+\S.*?[ \t](\d+)[ \t]+---[ \t]*$/gm;
  const found = [...text.matchAll(marker)];
  if (found.length === 0) return [{ pageNum: 1, text: text.trim() }];
  return found.map((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < found.length ? found[i + 1].index ?? text.length : text.length;
    return { pageNum: Number(m[1]), text: text.slice(start, end).trim() };
  });
}
