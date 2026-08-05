/**
 * Tafsir MCP — result parsing from tool call outputs (SPEC-TAFSIR §FR-5.3).
 *
 * The remote server returns JSON bodies as tool text content; the client
 * surfaces both the joined text and `structuredContent`. These pure helpers
 * normalise either form into flat display rows so the dialog stays dumb. Kept
 * dependency-free for unit tests.
 */

export interface TafsirRow {
  text: string;
  reference: string;
  /** Source attribution shown under the row, if the tool reports one. */
  source?: string;
}

export interface RawCall {
  text: string;
  structured?: unknown;
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { return undefined; }
}

/** Pull a JSON object/array out of a text block if it is one. */
function bestObject(raw: RawCall): unknown {
  if (raw.structured !== undefined) return raw.structured;
  const parsed = parseJson(raw.text);
  if (Array.isArray(parsed) && typeof parsed[0] === "object") return parsed;
  if (parsed && typeof parsed === "object") return parsed;
  return undefined;
}

/** fetch_ayah → one row. */
export function parseAyah(raw: RawCall): TafsirRow {
  const obj = bestObject(raw) as { text?: string; surah?: number; ayah?: number } | undefined;
  let reference = "";
  if (obj?.surah != null && obj?.ayah != null) reference = `سورہ ${obj.surah}:${obj.ayah}`;
  const text = obj?.text?.trim() || raw.text.trim();
  return { text, reference, source: "القرآن الكريم" };
}

/** fetch_tafsir → `{ tafsirs: [{ source, attribution, text }] }`. */
export function parseTafsirList(raw: RawCall): TafsirRow[] {
  const obj = bestObject(raw) as { tafsirs?: Array<{ source?: string; attribution?: string; text?: string }> } | undefined;
  const list = obj?.tafsirs;
  if (!Array.isArray(list)) return [];
  return list
    .map((t, i) => ({
      text: (t.text ?? "").trim(),
      reference: "",
      source: t.attribution ?? t.source,
      _i: i,
    }))
    .filter((r) => r.text)
    .map(({ text, reference, source }) => ({ text, reference, source }));
}

/** search_quran_text → array of { surah, ayah, text, snippet }. */
export function parseQuranSearch(raw: RawCall): TafsirRow[] {
  const arr = bestObject(raw);
  if (Array.isArray(arr)) {
    return (arr as Array<{ surah?: number; ayah?: number; text?: string }>)
      .map((r) => ({
        text: (r.text ?? "").trim(),
        reference: r.surah && r.ayah ? `سورہ ${r.surah}:${r.ayah}` : "",
        source: undefined,
      }))
      .filter((r) => r.text);
  }
  return [];
}

/** search_in_tafsir → array of { ... , text/snippet }. */
export function parseTafsirSearch(raw: RawCall): TafsirRow[] {
  const obj = bestObject(raw);
  if (Array.isArray(obj)) {
    return (obj as Array<{ text?: string; snippet?: string; source?: string; attribution?: string }>)
      .map((r) => ({
        text: (r.text ?? r.snippet ?? "").trim(),
        reference: "",
        source: r.attribution ?? r.source,
      }))
      .filter((r) => r.text);
  }
  return [];
}

/** Fallback: split the raw text into paragraph rows when parsing finds nothing. */
export function rowsFromTextBlocks(text: string): TafsirRow[] {
  return text
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((t) => ({ text: t, reference: "" as const }));
}