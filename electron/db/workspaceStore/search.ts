import type { SqliteDatabase } from '../open.js';
import { getCurrentUserId } from './identity.js';
import { normalizeArabicForSearch } from '../../../shared/text/arabicSearch.js';

/**
 * SPEC-M6 Phase 5: FTS5 keyword search over imported library chunks.
 *
 * The `library_chunks_fts` virtual table (maintained by ingest.storeChunk /
 * library.deleteItem, backfilled in electron/db/schema.ts) indexes a
 * normalized copy of each chunk under the `trigram` tokenizer, so Arabic
 * keyword search is insensitive to harakat and script variants and matches
 * substrings (الحسين matches والحسين). Each hit carries the page number so
 * the reader can deep-link.
 */

export interface ChunkSearchHit {
  /** library_items.id of the book the hit lives in. */
  itemId: string;
  /** library_items.title. */
  title: string;
  /** source_ref of the book (may carry shamelaBookId). */
  sourceRef: Record<string, unknown>;
  /** 1-based page number in the Shamela book, or null when unknown. */
  pageNumber: number | null;
  /** The chunk content itself (raw, for display/snippet). */
  content: string;
  /** Relative FTS relevance (lower = better). */
  rank: number;
}

const SNIPPET_LENGTH = 160;

/** Build a readable snippet around the first occurrence of `needle`. */
function makeSnippet(content: string, needle: string): string {
  const clean = content.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const lower = clean.toLowerCase();
  const idx = needle ? lower.indexOf(needle.toLowerCase()) : -1;
  if (idx === -1) return clean.slice(0, SNIPPET_LENGTH);
  const start = Math.max(0, idx - SNIPPET_LENGTH / 3);
  const end = Math.min(clean.length, start + SNIPPET_LENGTH);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < clean.length ? '…' : '';
  return prefix + clean.slice(start, end) + suffix;
}

/**
 * Keyword search across imported chunks. The query is normalized exactly like
 * the indexed text (so harakat/variants never break a match) then handed to
 * FTS5 as a quoted phrase — the `trigram` tokenizer turns that into substring
 * matching. Falls back to a LIKE scan when the FTS5 table is unavailable.
 */
export function searchChunks(
  db: SqliteDatabase,
  query: string,
  limit = 50,
): ChunkSearchHit[] {
  const userId = getCurrentUserId(db);
  const raw = query.trim();
  if (!raw) return [];

  const normalized = normalizeArabicForSearch(raw);
  const words = normalized.split(/\s+/).filter(Boolean);
  const ftsExpr = words.map((w) => `"${w.replace(/"/g, '""')}"`).join(' ');

  try {
    const rows = db.prepare(`
      SELECT f.search_text,
             f.page_number,
             li.id AS itemId,
             li.title,
             li.source_ref,
             bm25(library_chunks_fts) AS rank
      FROM library_chunks_fts f
      JOIN library_items li ON li.id = f.library_item_id AND li.user_id = ?
      WHERE library_chunks_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(userId, ftsExpr, limit) as Array<{
      search_text: string;
      page_number: number | null;
      itemId: string;
      title: string;
      source_ref: string;
      rank: number;
    }>;

    return rows.map((r) => ({
      itemId: r.itemId,
      title: r.title,
      sourceRef: JSON.parse(r.source_ref || '{}'),
      pageNumber: r.page_number ?? null,
      content: r.search_text,
      rank: r.rank,
    }));
  } catch (err) {
    // FTS5 virtual table missing or query unsupported — fall back to LIKE.
    console.warn('[search] FTS5 unavailable, using LIKE fallback:', err);
    const pattern = `%${raw}%`;
    const rows = db.prepare(`
      SELECT c.content,
             c.page_number,
             li.id AS itemId,
             li.title,
             li.source_ref
      FROM library_chunks c
      JOIN library_items li ON li.id = c.library_item_id AND li.user_id = ?
      WHERE c.content LIKE ?
      ORDER BY c.created_at DESC
      LIMIT ?
    `).all(userId, pattern, limit) as Array<{
      content: string;
      page_number: number | null;
      itemId: string;
      title: string;
      source_ref: string;
    }>;

    return rows.map((r) => ({
      itemId: r.itemId,
      title: r.title,
      sourceRef: JSON.parse(r.source_ref || '{}'),
      pageNumber: r.page_number ?? null,
      content: r.content,
      rank: 0,
    }));
  }
}

export { makeSnippet };
