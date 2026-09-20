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
  maxTokens?: number;
  overlapTokens?: number;
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

/**
 * Auto-detects text genre/kind from sample text when not explicitly provided.
 */
export function detectDocumentKind(text: string): DocumentKind {
  const sample = text.slice(0, 4000);
  const hadithMatches = sample.match(/(?:حَدَّثَنَا|حدثنا|أَخْبَرَنَا|اخبرنا|أَنْبَأَنَا|انبانا|حَدَّثَنِي|حدثني|أَخْبَرَنِي|اخبرني|عَنْ|عن\s+)/g);
  const hadithCount = hadithMatches ? hadithMatches.length : 0;

  const fiqhMatches = sample.match(/(?:^|\n)\s*(?:كتاب|كِتَابُ|باب|بَابُ|فصل|فَصْلٌ|مسألة|مَسْأَلَةٌ|فرع|فَرْعٌ)\s+/g);
  const fiqhCount = fiqhMatches ? fiqhMatches.length : 0;

  if (hadithCount >= 3) return 'hadith';
  if (fiqhCount >= 2) return 'fiqh';
  return 'prose';
}

/**
 * Structural chunking for Hadith literature:
 * Treats each narration (isnad + matn) as an indivisible structural unit
 * whenever within token/character limits (ADR 0055).
 */
function chunkHadithDocument(
  text: string,
  chunkSize: number,
  overlap: number,
): DocumentChunk[] {
  // Split on newlines where the next line begins a narration
  const narrationLineRegex = /\r?\n(?=(?:(?:\d+[\s\-–—.:]+)?(?:حَدَّثَنَا|حدثنا|أَخْبَرَنَا|اخبرنا|أَنْبَأَنَا|انبانا|حَدَّثَنِي|حدثني|أَخْبَرَنِي|اخبرني|رَوَى|روى)\b|\[\s*\d+\s*\]|\d+[\s\-–—.:]+))/g;

  const splitIndices: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = narrationLineRegex.exec(text)) !== null) {
    const splitPoint = m.index + m[0].length;
    if (!splitIndices.includes(splitPoint)) {
      splitIndices.push(splitPoint);
    }
    if (narrationLineRegex.lastIndex === m.index) {
      narrationLineRegex.lastIndex++;
    }
  }

  // If no structured narrations found, fall back to prose chunking with hadith tag
  if (splitIndices.length === 0) {
    return chunkProseDocument(text, chunkSize, overlap, 'hadith');
  }

  const sections: { start: number; end: number }[] = [];
  let prev = 0;
  for (const idx of splitIndices) {
    if (idx > prev) {
      sections.push({ start: prev, end: idx });
      prev = idx;
    }
  }
  if (prev < text.length) {
    sections.push({ start: prev, end: text.length });
  }

  const chunks: DocumentChunk[] = [];
  let chunkIndex = 0;
  const maxNarrationLimit = Math.round(chunkSize * 1.35);

  for (const sec of sections) {
    const secText = text.slice(sec.start, sec.end).trim();
    if (!secText) continue;

    // Extract leading isnad snippet if detectable
    let isnadSnippet: string | undefined;
    const cleanForMatch = secText.replace(/[\u064B-\u065F\u0670]/g, '');
    const mMatch = /(?:^[\s\S]*?(?:رسول\s+الله|النبي)[^:،.؛\n]*[:،.؛\n]?)/i.exec(cleanForMatch);
    if (mMatch) {
      isnadSnippet = secText.slice(0, mMatch[0].length).trim();
    } else {
      const colonIdx = secText.indexOf(':');
      if (colonIdx > 20 && colonIdx < 300) {
        isnadSnippet = secText.slice(0, colonIdx + 1).trim();
      }
    }

    if (secText.length <= maxNarrationLimit) {
      // Narration fits intact! Keep isnad + matn together.
      chunks.push({
        index: chunkIndex++,
        content: secText,
        charStart: sec.start,
        charEnd: sec.end,
        meta: {
          kind: 'hadith',
          ...(isnadSnippet ? { isnad: isnadSnippet } : {}),
        },
      });
    } else {
      // Narration is long; split into subchunks with sentence overlap
      const subChunks = chunkDocumentText(secText, chunkSize, overlap);
      for (const sc of subChunks) {
        chunks.push({
          index: chunkIndex++,
          content: sc.content,
          charStart: sec.start + sc.charStart,
          charEnd: sec.start + sc.charEnd,
          meta: {
            kind: 'hadith',
            ...(isnadSnippet ? { isnad: isnadSnippet } : {}),
          },
        });
      }
    }
  }

  return chunks;
}

/**
 * Structural chunking for Fiqh / Classical literature:
 * Segments along natural chapter/section boundaries (كتاب, باب, فصل, مسألة)
 * and attaches heading breadcrumbs to each chunk (ADR 0055).
 */
function chunkFiqhDocument(
  text: string,
  chunkSize: number,
  overlap: number,
  kind: 'fiqh' | 'classical' = 'fiqh',
): DocumentChunk[] {
  const headingLineRegex = /\r?\n(?=(?:كتاب|كِتَابُ|باب|بَابُ|فصل|فَصْلٌ|مسألة|مَسْأَلَةٌ|فرع|فَرْعٌ)\s+[^\r\n]+)/g;

  const splitIndices: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = headingLineRegex.exec(text)) !== null) {
    const splitPoint = m.index + m[0].length;
    if (!splitIndices.includes(splitPoint)) {
      splitIndices.push(splitPoint);
    }
    if (headingLineRegex.lastIndex === m.index) {
      headingLineRegex.lastIndex++;
    }
  }

  if (splitIndices.length === 0) {
    return chunkProseDocument(text, chunkSize, overlap, kind);
  }

  const sections: { start: number; end: number }[] = [];
  let prev = 0;
  for (const idx of splitIndices) {
    if (idx > prev) {
      sections.push({ start: prev, end: idx });
      prev = idx;
    }
  }
  if (prev < text.length) {
    sections.push({ start: prev, end: text.length });
  }

  const chunks: DocumentChunk[] = [];
  let chunkIndex = 0;
  const maxSectionLimit = Math.round(chunkSize * 1.25);

  let currentKitab = '';
  let currentBab = '';
  let currentFasl = '';

  for (const sec of sections) {
    const secText = text.slice(sec.start, sec.end).trim();
    if (!secText) continue;

    // Detect heading in the opening lines of this section
    const firstLine = secText.split('\n')[0].trim();
    if (/^(?:كتاب|كِتَابُ)\s+/i.test(firstLine)) {
      currentKitab = firstLine;
      currentBab = '';
      currentFasl = '';
    } else if (/^(?:باب|بَابُ)\s+/i.test(firstLine)) {
      currentBab = firstLine;
      currentFasl = '';
    } else if (/^(?:فصل|فَصْلٌ|مسألة|مَسْأَلَةٌ|فرع|فَرْعٌ)\s+/i.test(firstLine)) {
      currentFasl = firstLine;
    }

    const breadcrumbs = [currentKitab, currentBab, currentFasl].filter(Boolean).join(' > ');

    if (secText.length <= maxSectionLimit) {
      chunks.push({
        index: chunkIndex++,
        content: secText,
        charStart: sec.start,
        charEnd: sec.end,
        meta: {
          kind,
          ...(breadcrumbs ? { heading: breadcrumbs } : {}),
        },
      });
    } else {
      const subChunks = chunkDocumentText(secText, chunkSize, overlap);
      for (const sc of subChunks) {
        chunks.push({
          index: chunkIndex++,
          content: sc.content,
          charStart: sec.start + sc.charStart,
          charEnd: sec.start + sc.charEnd,
          meta: {
            kind,
            ...(breadcrumbs ? { heading: breadcrumbs } : {}),
          },
        });
      }
    }
  }

  return chunks;
}

/**
 * Standard prose chunking wrapper with metadata.
 */
function chunkProseDocument(
  text: string,
  chunkSize: number,
  overlap: number,
  kind: DocumentKind = 'prose',
): DocumentChunk[] {
  const chunks = chunkDocumentText(text, chunkSize, overlap);
  for (const c of chunks) {
    c.meta = { kind };
  }
  return chunks;
}

/**
 * Adaptive structural chunker for classical and modern documents (ADR 0055).
 * - 'hadith': keeps narration (isnad + matn) intact as single structural unit when within size limits.
 * - 'fiqh' / 'classical': segments along headings (كتاب, باب, فصل) with heading breadcrumbs.
 * - 'prose': sliding sentence-aware window.
 */
export function chunkDocumentAdaptive(
  text: string,
  options: AdaptiveChunkOptions = {},
): DocumentChunk[] {
  const cleanText = text.trim();
  if (!cleanText) return [];

  const chunkSize = options.chunkSize ?? CHUNK_SIZE;
  const overlap = options.overlap ?? CHUNK_OVERLAP;
  const kind = options.kind ?? detectDocumentKind(cleanText);

  switch (kind) {
    case 'hadith':
      return chunkHadithDocument(cleanText, chunkSize, overlap);
    case 'fiqh':
    case 'classical':
      return chunkFiqhDocument(cleanText, chunkSize, overlap, kind);
    case 'prose':
    default:
      return chunkProseDocument(cleanText, chunkSize, overlap, 'prose');
  }
}
