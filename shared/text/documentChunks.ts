// Sentence-aware chunker for library documents (SPEC-M4 FR-2.2, SPEC-M5 FR-1.3).
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

export interface DocumentChunk {
  index: number;
  content: string;
  charStart: number;
  charEnd: number;
}

/** ~1200 characters per chunk with ~150 characters of overlap. */
export const CHUNK_SIZE = 1200;
export const CHUNK_OVERLAP = 150;

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
