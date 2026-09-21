// AUTO-MIRRORED from shared\text\documentChunks.ts — edge deploy bundles only supabase/functions/.
// Edit shared\text\documentChunks.ts and re-run: node scripts/mirror-shared.mjs
// Sentence-aware chunker for library documents (SPEC-M4 FR-2.2, SPEC-M5 FR-1.3, ADR 0055).
//
// WHY THIS FILE EXISTS: the same book must chunk identically no matter which
// runtime ingests it. Until M5.9 this logic lived only inside
// supabase/functions/library-ingest/index.ts, so the Electron main process had
// no way to reach it — and copying it would have been risk R2: two copies that
// drift, and the same text split differently in the cloud corpus and the local
// one. Chunk boundaries decide what a citation quotes, so drift here is not
// cosmetic.
//
// Both runtimes import this module: Deno via
// supabase/functions/_shared/mirror/text/documentChunks.ts (kept in sync by
// scripts/mirror-shared.mjs), Electron main directly.
//
// Keep it runtime-agnostic — no Deno.*, node:, window, or process.

export interface DocumentChunkMeta {
  kind?: 'hadith' | 'fiqh' | 'classical' | 'prose';
  heading?: string;
  isnad?: string;
  [key: string]: unknown;
}

export interface DocumentChunk {
  index: number;
  content: string;
  charStart: number;
  charEnd: number;
  meta?: DocumentChunkMeta;
}

/** ~1200 characters per chunk with ~150 characters of overlap. */
export const CHUNK_SIZE = 1200;
export const CHUNK_OVERLAP = 150;

export type DocumentKind = 'hadith' | 'fiqh' | 'classical' | 'prose';

export interface AdaptiveChunkOptions {
  kind?: DocumentKind;
  chunkSize?: number;
  overlap?: number;
}

/**
 * Splits document text into overlapping chunks, preferring to break on a
 * sentence boundary. Boundaries are detected across Urdu (۔), Arabic (؟),
 * and Latin (. !) punctuation plus newlines.
 *
 * The overlap means consecutive chunks share trailing context, so a sentence
 * straddling a boundary still appears whole in at least one chunk.
 */
export function chunkDocumentText(
  text: string,
  chunkSize = CHUNK_SIZE,
  overlap = CHUNK_OVERLAP,
): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  const cleanText = text.trim();
  if (!cleanText) return [];

  let start = 0;
  let chunkIndex = 0;

  while (start < cleanText.length) {
    let end = Math.min(start + chunkSize, cleanText.length);

    if (end < cleanText.length) {
      // Find clean sentence boundary backward within the overlap window
      const searchWindow = cleanText.slice(Math.max(start, end - overlap), end);
      const match = /[.!؟۔\n]+/g.exec(searchWindow);
      if (match) {
        end = Math.max(start, end - overlap) + match.index + match[0].length;
      }
    }

    const chunkContent = cleanText.slice(start, end).trim();
    if (chunkContent.length > 0) {
      chunks.push({
        index: chunkIndex++,
        content: chunkContent,
        charStart: start,
        charEnd: end,
      });
    }

    if (end >= cleanText.length) break;
    start = Math.max(start + 1, end - overlap);
  }

  return chunks;
}

// ─── Adaptive structural chunking (ADR 0055) ────────────────────────────────
//
// Everything below runs its patterns against a "plain view" of the text: the
// same characters with tashkeel removed and alif variants folded, plus a map
// back to offsets in the ORIGINAL text. Two reasons:
//
//  1. Classical texts arrive both vowelled and bare (حَدَّثَنَا / حدثنا). One set
//     of patterns on the plain view covers both, instead of a hand-maintained
//     list of vowelled spellings that misses every variant nobody listed.
//  2. `\b` does not work for Arabic. Without the `u` flag JavaScript treats only
//     [A-Za-z0-9_] as word characters, so `حدثنا\b` can NEVER match — there is
//     no boundary between two non-word characters. The first version of this
//     chunker used it, so isnad-initial narrations never split. We use explicit
//     Arabic-letter lookarounds instead.

/** Arabic letters (base block). A "word boundary" for Arabic text. */
const AR_LETTER = '\\u0621-\\u064A';
const NOT_AR_AFTER = `(?![${AR_LETTER}])`;

/** Tashkeel and Quranic annotation marks — removed in the plain view. */
const MARK_RE = /[ً-ٰٟۖ-ۜ۟-۪ۨ-ۭ]/;

interface PlainView {
  plain: string;
  /** map[i] = offset in the original text of plain[i]; map[plain.length] = original length. */
  map: number[];
}

function plainView(text: string): PlainView {
  let plain = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (MARK_RE.test(ch)) continue;
    map.push(i);
    // 1:1 folds only, so plain and the map stay aligned
    plain += ch === 'أ' || ch === 'إ' || ch === 'آ' || ch === 'ٱ' ? 'ا' : ch === 'ى' ? 'ي' : ch;
  }
  map.push(text.length);
  return { plain, map };
}

/** Isnad transmission verbs, in PLAIN form (hamza folded, so أخبرنا is اخبرنا and أنبأنا is انبانا). */
const TRANSMISSION = 'حدثنا|حدثني|اخبرنا|اخبرني|انبانا|روى';
const TRANSMISSION_RE = new RegExp(`(?<![${AR_LETTER}])(?:${TRANSMISSION})${NOT_AR_AFTER}`, 'g');

/** A leading narration number: "12 -", "12.", "[12]", "١٢ -" (Arabic-Indic digits too). */
const NUM = '(?:\\[\\s*[\\d\\u0660-\\u0669]+\\s*\\]|[\\d\\u0660-\\u0669]+\\s*[-–—.:)])';

/** A line that starts a new narration: numbered, or opening with a transmission verb. */
const NARRATION_START_RE = new RegExp(
  `\\r?\\n(?=(?:${NUM}[ \\t]*)?(?:${TRANSMISSION})${NOT_AR_AFTER}|${NUM}[ \\t])`,
  'g',
);

/** Fiqh/classical chapter words, in PLAIN form (مسألة becomes مسالة). */
const HEADING_WORDS = 'كتاب|باب|فصل|مسالة|فرع';
/** A short line beginning with a heading word. Length-capped so a prose sentence
 *  that merely starts with "كتاب …" is not mistaken for a chapter heading. */
const HEADING_LINE = `(?:${HEADING_WORDS})[ \\t]+[^\\r\\n]{1,80}`;
const HEADING_SPLIT_RE = new RegExp(`\\r?\\n(?=${HEADING_LINE}(?:\\r?\\n|$))`, 'g');
const HEADING_DETECT_RE = new RegExp(`(?:^|\\n)[ \\t]*${HEADING_LINE}(?=\\r?\\n|$)`, 'g');

/** Kinds a caller may legitimately pass; anything else means "detect it". */
const VALID_KINDS: ReadonlySet<string> = new Set(['hadith', 'fiqh', 'classical', 'prose']);

/**
 * Maps a free-form library `kind` / `discipline` / `category` value to a
 * DocumentKind, or `undefined` meaning "detect from the text".
 *
 * Ingest passes `meta.kind || meta.discipline || meta.category`. Those hold
 * things like "fatwa", "rijal" or "general", which are not chunking strategies;
 * handing them straight through made every such item silently fall into the
 * prose branch and skip detection entirely.
 */
export function normalizeDocumentKind(raw: unknown): DocumentKind | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim().toLowerCase();
  if (VALID_KINDS.has(v)) return v as DocumentKind;
  if (v === 'fatwa') return 'fiqh';
  if (v === 'rijal' || v === 'lughat' || v === 'nahw') return 'classical';
  return undefined;
}

/**
 * Auto-detects text genre/kind from sample text when not explicitly provided.
 *
 * Hadith is recognised by isnad transmission verbs only. It used to also count
 * the bare word «عن», which appears in nearly every stretch of ordinary Arabic
 * prose ("about"), so any essay with three of them was chunked as hadith.
 */
export function detectDocumentKind(text: string): DocumentKind {
  const { plain } = plainView(text.slice(0, 4000));

  const transmissionCount = plain.match(TRANSMISSION_RE)?.length ?? 0;
  if (transmissionCount >= 2) return 'hadith';

  const headingCount = plain.match(HEADING_DETECT_RE)?.length ?? 0;
  if (headingCount >= 2) return 'fiqh';

  return 'prose';
}

interface Section { start: number; end: number }

/**
 * Cuts `text` at each match of `splitRe` (a newline followed by a lookahead), in
 * ORIGINAL-text offsets. `splitRe` runs on the plain view and is mapped back.
 */
function sectionsBySplit(text: string, view: PlainView, splitRe: RegExp): Section[] {
  const cuts: number[] = [];
  splitRe.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = splitRe.exec(view.plain)) !== null) {
    const point = view.map[m.index + m[0].length];
    if (point > 0 && point < text.length && cuts[cuts.length - 1] !== point) cuts.push(point);
    if (splitRe.lastIndex === m.index) splitRe.lastIndex++;
  }
  const sections: Section[] = [];
  let prev = 0;
  for (const c of cuts) {
    if (c > prev) sections.push({ start: prev, end: c });
    prev = c;
  }
  if (prev < text.length) sections.push({ start: prev, end: text.length });
  return sections;
}

/** Trims a section and returns its text with offsets that still index the ORIGINAL. */
function trimmedSection(text: string, sec: Section): { body: string; start: number } | null {
  const raw = text.slice(sec.start, sec.end);
  const body = raw.trim();
  if (!body) return null;
  return { body, start: sec.start + (raw.length - raw.trimStart().length) };
}

/** Emits a section whole if it fits, otherwise as overlapping sub-chunks. */
function emitSection(
  out: DocumentChunk[],
  body: string,
  start: number,
  limit: number,
  chunkSize: number,
  overlap: number,
  meta: DocumentChunkMeta,
): void {
  if (body.length <= limit) {
    out.push({ index: out.length, content: body, charStart: start, charEnd: start + body.length, meta: { ...meta } });
    return;
  }
  for (const sc of chunkDocumentText(body, chunkSize, overlap)) {
    out.push({
      index: out.length,
      content: sc.content,
      charStart: start + sc.charStart,
      charEnd: start + sc.charEnd,
      meta: { ...meta },
    });
  }
}

/**
 * Structural chunking for Hadith literature: each narration (isnad + matn) is one
 * indivisible unit whenever it fits, so the chain never ends up in a different
 * chunk from the text it transmits.
 */
function chunkHadithDocument(text: string, chunkSize: number, overlap: number): DocumentChunk[] {
  const view = plainView(text);
  const sections = sectionsBySplit(text, view, NARRATION_START_RE);

  // No narration boundaries found: nothing structural to keep together.
  if (sections.length <= 1) return chunkProseDocument(text, chunkSize, overlap, 'hadith');

  const out: DocumentChunk[] = [];
  const limit = Math.round(chunkSize * 1.35);

  for (const sec of sections) {
    const t = trimmedSection(text, sec);
    if (!t) continue;

    const meta: DocumentChunkMeta = { kind: 'hadith' };
    const isnad = leadingIsnad(t.body);
    if (isnad) meta.isnad = isnad;

    emitSection(out, t.body, t.start, limit, chunkSize, overlap, meta);
  }
  return out;
}

/** The isnad: everything up to the end of the clause that names the Prophet ﷺ. */
function leadingIsnad(body: string): string | undefined {
  const view = plainView(body);
  const m = /^[\s\S]*?(?:رسول\s+الله|النبي)[^:،.؛\n]*[:،.؛\n]?/.exec(view.plain);
  if (m) return body.slice(0, view.map[m[0].length]).trim() || undefined;

  // No Prophetic reference (a report from a Companion or Successor): fall back
  // to the first colon if it sits where an isnad would end.
  const colon = body.indexOf(':');
  return colon > 20 && colon < 300 ? body.slice(0, colon + 1).trim() : undefined;
}

/**
 * Structural chunking for Fiqh / classical literature: sections follow chapter
 * headings (كتاب, باب, فصل, مسألة, فرع) and each chunk carries its heading trail.
 */
function chunkFiqhDocument(
  text: string,
  chunkSize: number,
  overlap: number,
  kind: 'fiqh' | 'classical' = 'fiqh',
): DocumentChunk[] {
  const view = plainView(text);
  const sections = sectionsBySplit(text, view, HEADING_SPLIT_RE);
  if (sections.length <= 1) return chunkProseDocument(text, chunkSize, overlap, kind);

  const out: DocumentChunk[] = [];
  const limit = Math.round(chunkSize * 1.25);
  let kitab = '';
  let bab = '';
  let fasl = '';

  for (const sec of sections) {
    const t = trimmedSection(text, sec);
    if (!t) continue;

    // Heading words are matched on the plain form so vowelled headings count too.
    const firstLine = t.body.split('\n')[0].trim();
    const plainFirst = plainView(firstLine).plain;
    if (/^كتاب\s/.test(plainFirst)) {
      kitab = firstLine; bab = ''; fasl = '';
    } else if (/^باب\s/.test(plainFirst)) {
      bab = firstLine; fasl = '';
    } else if (/^(?:فصل|مسالة|فرع)\s/.test(plainFirst)) {
      fasl = firstLine;
    }

    const heading = [kitab, bab, fasl].filter(Boolean).join(' > ');
    emitSection(out, t.body, t.start, limit, chunkSize, overlap, { kind, ...(heading ? { heading } : {}) });
  }
  return out;
}

/** Standard sentence-aware prose chunking, tagged with the kind that chose it. */
function chunkProseDocument(
  text: string,
  chunkSize: number,
  overlap: number,
  kind: DocumentKind = 'prose',
): DocumentChunk[] {
  const chunks = chunkDocumentText(text, chunkSize, overlap);
  // chunkDocumentText trims first and reports offsets into the TRIMMED text.
  // Shift by the trimmed-off prefix so these offsets index the text we were
  // given — `text.slice(charStart, charEnd)` is then the chunk. (The legacy
  // chunker itself is left as it was: stored offsets depend on it.)
  const lead = text.length - text.trimStart().length;
  for (const c of chunks) {
    c.charStart += lead;
    c.charEnd += lead;
    c.meta = { kind };
  }
  return chunks;
}

/**
 * Adaptive structural chunker for classical and modern documents (ADR 0055).
 * - 'hadith': keeps each narration (isnad + matn) whole when it fits.
 * - 'fiqh' / 'classical': segments along chapter headings, carrying a heading trail.
 * - 'prose': sliding sentence-aware window.
 *
 * `charStart` / `charEnd` always index the text PASSED IN (untrimmed), so
 * `text.slice(charStart, charEnd)` is the chunk.
 * Deterministic: the same text and options always give the same chunks — ingest
 * resumes by chunk index and depends on that.
 */
export function chunkDocumentAdaptive(
  text: string,
  options: AdaptiveChunkOptions = {},
): DocumentChunk[] {
  if (!text || !text.trim()) return [];

  const chunkSize = options.chunkSize ?? CHUNK_SIZE;
  const overlap = options.overlap ?? CHUNK_OVERLAP;
  const kind = options.kind ?? detectDocumentKind(text);

  switch (kind) {
    case 'hadith':
      return chunkHadithDocument(text, chunkSize, overlap);
    case 'fiqh':
    case 'classical':
      return chunkFiqhDocument(text, chunkSize, overlap, kind);
    case 'prose':
    default:
      return chunkProseDocument(text, chunkSize, overlap, 'prose');
  }
}
