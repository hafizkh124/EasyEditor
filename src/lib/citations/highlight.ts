/**
 * Marks the user's search words inside a passage, ignoring diacritics and the
 * usual Arabic spelling variants — the way Shamela paints the match in red.
 *
 * Works on the ORIGINAL text: each character is folded on its own (harakat
 * drop out, أ/إ/آ/ٱ become ا, ة becomes ه, ى becomes ي) while an index map keeps
 * every folded character tied to where it came from, so the returned ranges
 * cut the original string and a word that carries tashkeel is still found.
 *
 * Only used when the query itself is Arabic. Urdu topical questions ("پڑوسی کے
 * حقوق") contain everyday words that would light up half of every passage.
 */

const TASHKEEL = /[ً-ْٰـ]/;
const ARABIC_LETTER = /[ء-يٱ-ۓ]/;
const URDU_ONLY = /[ٹڈڑںےپچژگھہۂ]/;

function foldChar(c: string): string {
  if (TASHKEEL.test(c)) return "";
  if ("آأإٱ".includes(c)) return "ا";
  if (c === "ة") return "ه";
  if (c === "ى") return "ي";
  return c;
}

/** Folded form plus, for every folded char, the index of its source in `text`. */
export function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const f = foldChar(text[i]);
    if (f === "") continue;
    folded += f;
    map.push(i);
  }
  return { folded, map };
}

/** The query's Arabic words worth marking: 3+ letters, and only if the query is Arabic, not Urdu. */
export function queryWords(query: string | undefined | null): string[] {
  if (!query) return [];
  const letters = (query.match(/[ء-يٱ-ۓ]/g) ?? []).length;
  if (letters < 6) return [];
  const urdu = (query.match(new RegExp(URDU_ONLY.source, "g")) ?? []).length;
  if (urdu / letters >= 0.02) return [];
  const words = foldWithMap(query).folded
    .split(/[^ء-يٱ-ۓ]+/)
    .filter((w) => w.length >= 3 && [...w].every((ch) => ARABIC_LETTER.test(ch)));
  return [...new Set(words)];
}

export interface Segment {
  text: string;
  match: boolean;
}

/** Splits `text` into plain and matched pieces (matches are whole original characters, tashkeel included). */
export function highlightSegments(text: string, query: string | undefined | null): Segment[] {
  const words = queryWords(query);
  if (!text || words.length === 0) return [{ text, match: false }];

  const { folded, map } = foldWithMap(text);
  const ranges: Array<[number, number]> = [];
  for (const w of words) {
    let from = 0;
    for (;;) {
      const at = folded.indexOf(w, from);
      if (at === -1) break;
      const start = map[at];
      // include any harakat that trail the last matched letter
      let end = map[at + w.length - 1] + 1;
      while (end < text.length && TASHKEEL.test(text[end])) end++;
      ranges.push([start, end]);
      from = at + w.length;
    }
  }
  if (ranges.length === 0) return [{ text, match: false }];

  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }

  const out: Segment[] = [];
  let pos = 0;
  for (const [s, e] of merged) {
    if (s > pos) out.push({ text: text.slice(pos, s), match: false });
    out.push({ text: text.slice(s, e), match: true });
    pos = e;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), match: false });
  return out;
}
