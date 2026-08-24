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

/** A non-null object with at least one key, or a non-empty array. */
function isUsableObject(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.length > 0;
  return Object.keys(value).length > 0;
}

/**
 * Pull a JSON object/array out of a call result. `structured` is preferred,
 * but only when it actually carries something — a server that wraps its
 * payload as `structuredContent: {}` while the real JSON sits in `text`
 * would otherwise make every parser fail even though parseable data was
 * right there.
 */
function bestObject(raw: RawCall): unknown {
  if (isUsableObject(raw.structured)) return raw.structured;
  const parsed = parseJson(raw.text);
  if (Array.isArray(parsed) && typeof parsed[0] === "object") return parsed;
  if (parsed && typeof parsed === "object") return parsed;
  return raw.structured;
}

/** True when `text` parses as JSON at all — used to decide whether falling
 *  back to it as plain prose is safe, or would leak raw JSON to the user. */
function looksLikeJson(text: string): boolean {
  return parseJson(text) !== undefined;
}

/** Unwrap a bare array, or the first array-valued property of a wrapper
 *  object (`{results: […]}`, `{items: […]}`, `{data: […]}`) — servers are
 *  not required to return a top-level array, and a wrapper should not read
 *  as "no results". */
function asArray(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    for (const key of ["results", "items", "data"]) {
      const v = (value as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v;
    }
  }
  return undefined;
}

/** fetch_ayah → one row. */
export function parseAyah(raw: RawCall): TafsirRow {
  const obj = bestObject(raw) as { text?: string; surah?: number; ayah?: number } | undefined;
  let reference = "";
  if (obj?.surah != null && obj?.ayah != null) reference = `سورہ ${obj.surah}:${obj.ayah}`;
  // Only degrade to the raw text when it is NOT itself JSON — otherwise a
  // shape mismatch (parseable JSON with no `.text` field) would surface raw
  // JSON as the ayah's text, insertable into the document as-is.
  const text = obj?.text?.trim() || (looksLikeJson(raw.text) ? "" : raw.text.trim());
  return { text, reference, source: "القرآن الكريم" };
}

/** fetch_tafsir → `{ tafsirs: [{ source, attribution, text }] }`. */
export function parseTafsirList(raw: RawCall): TafsirRow[] {
  const obj = bestObject(raw) as { tafsirs?: Array<{ source?: string; attribution?: string; text?: string }> } | undefined;
  const list = obj?.tafsirs;
  if (!Array.isArray(list)) return [];
  return list
    .map((t) => ({ text: (t.text ?? "").trim(), reference: "", source: t.attribution ?? t.source }))
    .filter((r) => r.text);
}

/** search_quran_text → array of { surah, ayah, text, snippet }, or a wrapper around one. */
export function parseQuranSearch(raw: RawCall): TafsirRow[] {
  const arr = asArray(bestObject(raw));
  if (!arr) return [];
  return (arr as Array<{ surah?: number; ayah?: number; text?: string }>)
    .map((r) => ({
      text: (r.text ?? "").trim(),
      reference: r.surah && r.ayah ? `سورہ ${r.surah}:${r.ayah}` : "",
      source: undefined,
    }))
    .filter((r) => r.text);
}

/** search_in_tafsir → array of { ... , text/snippet }, or a wrapper around one. */
export function parseTafsirSearch(raw: RawCall): TafsirRow[] {
  const arr = asArray(bestObject(raw));
  if (!arr) return [];
  return (arr as Array<{ text?: string; snippet?: string; source?: string; attribution?: string }>)
    .map((r) => ({
      text: (r.text ?? r.snippet ?? "").trim(),
      reference: "",
      source: r.attribution ?? r.source,
    }))
    .filter((r) => r.text);
}

export interface TafsirSourceOption {
  slug: string;
  label: string;
}

/**
 * list_tafsir_sources → array of { slug, attribution|name }, or a wrapper
 * around one. Previously each caller re-implemented this with a raw
 * `JSON.parse(res.text)` that ignored `res.structured` entirely and left a
 * silently-empty dropdown on any parse failure (a bare `catch { log }`) — routed
 * through `bestObject`/`asArray` here instead, so it gets the same
 * structured-content preference and wrapper-unwrapping every other parser does.
 */
export function parseTafsirSources(raw: RawCall): TafsirSourceOption[] {
  const arr = asArray(bestObject(raw));
  if (!arr) return [];
  return (arr as Array<{ slug?: string; attribution?: string; name?: string }>)
    .map((it) => ({ slug: String(it.slug ?? ""), label: String(it.attribution ?? it.name ?? it.slug ?? "") }))
    .filter((s) => s.slug);
}

/** Fallback: split the raw text into paragraph rows when parsing finds nothing. */
export function rowsFromTextBlocks(text: string): TafsirRow[] {
  return text
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((t) => ({ text: t, reference: "" as const }));
}