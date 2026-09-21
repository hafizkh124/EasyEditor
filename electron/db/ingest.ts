// Local library ingest (SPEC-M5 FR-4.x / SPEC-M5.9 FR-1).
//
// The desktop counterpart of supabase/functions/library-ingest. Until this
// existed, `callEdgeFunction("library-ingest")` hit the explicit refusal in
// electron/ipc/aiHandlers.ts, so nothing could enter the local corpus at all
// and the M5.3 exit criterion ("a 300-page PDF ingests locally") was
// unreachable.
//
// It deliberately answers with the SAME shape the edge function returns:
//
//   { item_id, inserted, next_offset, done, total_chunks, progress }
//
// because src/lib/corpus/ingestOrchestrator.ts drives both. If this contract
// needed to change, the orchestrator would have to grow a mode branch — and a
// mode branch in orchestration is what the whole backend adapter exists to
// prevent (SPEC-M5 FR-1, ADR-0006).

import type { SqliteDatabase } from './open.js';
import { getCurrentUserId, genId } from './workspaceStore/identity.js';
import { upsertChunkVector } from './vectorSearch.js';
import { readLibraryFile } from './fileStore.js';
import { embedTextContent } from '../ai/geminiClient.js';
import {
  chunkDocumentText,
  chunkDocumentAdaptive,
  type DocumentChunk,
  normalizeDocumentKind,
} from '../../shared/text/documentChunks.js';
import { extractTextFromBuffer } from '../../shared/text/fileText.js';
import { normalizeArabicForSearch } from '../../shared/text/arabicSearch.js';

export interface IngestBatchArgs {
  itemId: string;
  offset?: number;
  batchSize?: number;
  /** Aborts between chunks. Everything already committed stays committed. */
  signal?: { aborted: boolean };
}

export interface IngestBatchResult {
  item_id: string;
  inserted: number;
  next_offset: number;
  done: boolean;
  total_chunks: number;
  progress: number;
}

interface ItemRow {
  id: string;
  storage_path: string | null;
  meta: string;
}

type IngestMeta = {
  status?: string;
  progress?: number;
  total_chunks?: number;
  next_offset?: number;
  extracted_text?: string;
  error?: string;
  chunker?: string;
};

function readItem(db: SqliteDatabase, itemId: string, userId: string): ItemRow {
  const row = db
    .prepare('SELECT id, storage_path, meta FROM library_items WHERE id = ? AND user_id = ?')
    .get(itemId, userId) as ItemRow | undefined;
  if (!row) throw new Error('Library item not found or access denied');
  return row;
}

function parseMeta(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeIngestMeta(
  db: SqliteDatabase,
  itemId: string,
  baseMeta: Record<string, unknown>,
  ingest: IngestMeta,
): void {
  db.prepare('UPDATE library_items SET meta = ? WHERE id = ?')
    .run(JSON.stringify({ ...baseMeta, ingest }), itemId);
}

/**
 * Resolves the item's text. The extracted text is cached on the item while a
 * run is unfinished and dropped once it completes, mirroring the edge
 * function: a 300-page PDF spans many batches, and re-parsing it for each one
 * multiplies the work by the batch count.
 */
function resolveText(
  db: SqliteDatabase,
  item: ItemRow,
  meta: Record<string, unknown>,
): string {
  const cached = (meta.ingest as IngestMeta | undefined)?.extracted_text;
  if (typeof cached === 'string' && cached.length > 0) return cached;

  if (!item.storage_path) throw new Error('Library item missing storage_path');

  const bytes = readLibraryFile(item.storage_path);
  if (!bytes) {
    const marker = '[Could not read file]';
    writeIngestMeta(db, item.id, meta, { status: 'failed', error: marker, progress: 0 });
    return marker;
  }

  const ext = item.storage_path.split('.').pop()?.toLowerCase() || '';
  return extractTextFromBuffer(new Uint8Array(bytes), ext);
}

/**
 * Embeds and stores one batch of chunks, then reports where to resume.
 *
 * Each chunk is committed as it is embedded rather than in one transaction at
 * the end, so a cancel — or a crash — leaves finished work in place and
 * `meta.ingest.next_offset` pointing at the first chunk that still needs
 * doing. Re-running never re-spends on an embedding that already exists.
 */
export async function ingestLibraryItem(
  db: SqliteDatabase,
  { itemId, offset = 0, batchSize = 100, signal }: IngestBatchArgs,
): Promise<IngestBatchResult> {
  const userId = getCurrentUserId(db);
  const item = readItem(db, itemId, userId);
  const meta = parseMeta(item.meta);

  const fullText = resolveText(db, item, meta);
  if (fullText.startsWith('[')) {
    // Extraction failed; resolveText already recorded the reason.
    throw new Error(fullText);
  }

  // First field that names a real chunking strategy; otherwise undefined, i.e.
  // detect from the text (see normalizeDocumentKind).
  const ingestKind =
    normalizeDocumentKind(meta.kind) ??
    normalizeDocumentKind(meta.discipline) ??
    normalizeDocumentKind(meta.category);
  const isResumingLegacy = offset > 0 && (meta.ingest as IngestMeta | undefined)?.chunker !== 'adaptive-v1';
  const allChunks = isResumingLegacy
    ? chunkDocumentText(fullText)
    : chunkDocumentAdaptive(fullText, { kind: ingestKind });
  const totalChunks = allChunks.length;

  if (totalChunks === 0) {
    writeIngestMeta(db, itemId, meta, {
      status: 'ready', progress: 100, total_chunks: 0,
      chunker: isResumingLegacy ? undefined : 'adaptive-v1',
    });
    return { item_id: itemId, inserted: 0, next_offset: 0, done: true, total_chunks: 0, progress: 100 };
  }

  const currentOffset = Math.min(offset, totalChunks);
  const batch = allChunks.slice(currentOffset, currentOffset + batchSize);

  if (batch.length === 0) {
    writeIngestMeta(db, itemId, meta, {
      status: 'ready', progress: 100, total_chunks: totalChunks,
      chunker: isResumingLegacy ? undefined : 'adaptive-v1',
    });
    return {
      item_id: itemId, inserted: 0, next_offset: totalChunks,
      done: true, total_chunks: totalChunks, progress: 100,
    };
  }

  let inserted = 0;
  for (const chunk of batch) {
    if (signal?.aborted) break;
    const embedding = await embedTextContent(chunk.content);
    storeChunk({ db, userId, itemId, chunk, embedding });
    inserted++;
  }

  const nextOffset = currentOffset + inserted;
  const isDone = nextOffset >= totalChunks;
  const progress = Math.round((nextOffset / totalChunks) * 100);

  writeIngestMeta(db, itemId, meta, {
    status: isDone ? 'ready' : 'embedding',
    progress,
    total_chunks: totalChunks,
    next_offset: nextOffset,
    chunker: isResumingLegacy ? undefined : 'adaptive-v1',
    // Carried only while unfinished, so a completed item does not keep a
    // second full copy of the book in its metadata.
    ...(isDone ? {} : { extracted_text: fullText }),
  });

  return { item_id: itemId, inserted, next_offset: nextOffset, done: isDone, total_chunks: totalChunks, progress };
}

/**
 * Writes one chunk row plus its vector. `page_number`/`part_number` stay null
 * for file uploads; the Shamela importer (SPEC-M5.9 FR-2.4) fills them, which
 * is what lets a citation name book + volume + page.
 */
export function storeChunk({
  db, userId, itemId, chunk, embedding, pageNumber = null, partNumber = null,
}: {
  db: SqliteDatabase;
  userId: string;
  itemId: string;
  chunk: DocumentChunk;
  embedding: number[];
  pageNumber?: number | null;
  partNumber?: number | null;
}): void {
  const existing = db
    .prepare('SELECT id FROM library_chunks WHERE library_item_id = ? AND chunk_index = ?')
    .get(itemId, chunk.index) as { id: string } | undefined;

  const chunkId = existing?.id ?? genId('chk');

  db.prepare(`
    INSERT INTO library_chunks
      (id, user_id, library_item_id, chunk_index, content, language, char_start, char_end, page_number, part_number, meta, created_at)
    VALUES (?, ?, ?, ?, ?, 'ur', ?, ?, ?, ?, ?, ?)
    ON CONFLICT (library_item_id, chunk_index) DO UPDATE SET
      content = excluded.content,
      char_start = excluded.char_start,
      char_end = excluded.char_end,
      page_number = excluded.page_number,
      part_number = excluded.part_number,
      meta = excluded.meta
  `).run(
    chunkId, userId, itemId, chunk.index, chunk.content,
    chunk.charStart, chunk.charEnd, pageNumber, partNumber,
    JSON.stringify(chunk.meta || {}),
    new Date().toISOString(),
  );

  // SPEC-M6 Phase 5: keep the FTS5 keyword-search index in sync. Stored text
  // is normalized so Arabic diacritics/variants don't break a match. Keyed by
  // (library_item_id, chunk_index) so re-storing a chunk replaces its row.
  db.prepare('DELETE FROM library_chunks_fts WHERE library_item_id = ? AND chunk_index = ?')
    .run(itemId, chunk.index);
  db.prepare(
    'INSERT INTO library_chunks_fts (search_text, library_item_id, chunk_index, page_number, part_number) VALUES (?, ?, ?, ?, ?)',
  ).run(normalizeArabicForSearch(chunk.content), itemId, chunk.index, pageNumber, partNumber);

  // verifyEmbeddingModelLock runs inside upsertChunkVector: a corpus built on
  // one embedding model must refuse a vector from another rather than store
  // it into a space where cosine similarity is meaningless (risk R3).
  upsertChunkVector(db, chunkId, embedding);
}
