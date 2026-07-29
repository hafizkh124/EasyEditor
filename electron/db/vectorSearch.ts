import { EMBED_MODEL, EMBED_DIMS } from '../../shared/ai/embedConstants.js';
import type { SqliteDatabase } from './open.js';

export interface VectorSearchResult {
  chunkId: string;
  libraryItemId: string;
  content: string;
  pageNumber: number | null;
  partNumber: number | null;
  distance: number;
}

export class EmbeddingModelMismatchError extends Error {
  constructor(storedModel: string, currentModel: string) {
    super(
      `Embedding model mismatch: Local database vectors were generated with "${storedModel}", but search query is using "${currentModel}". Vector search cannot return valid results across different embedding spaces.`,
    );
    this.name = 'EmbeddingModelMismatchError';
  }
}

/**
 * Checks that the stored embedding model in corpus_meta matches EMBED_MODEL.
 */
export function verifyEmbeddingModelLock(db: SqliteDatabase): void {
  const getMeta = db.prepare("SELECT value FROM corpus_meta WHERE key = 'embed_model'");
  const row = getMeta.get() as { value: string } | undefined;
  const storedModel = row?.value || EMBED_MODEL;

  if (storedModel !== EMBED_MODEL) {
    throw new EmbeddingModelMismatchError(storedModel, EMBED_MODEL);
  }
}

/**
 * Searches local library chunks using sqlite-vec vector distance.
 */
export function searchVectorChunks(
  db: SqliteDatabase,
  queryEmbedding: number[],
  limit = 10,
): VectorSearchResult[] {
  verifyEmbeddingModelLock(db);

  if (!Array.isArray(queryEmbedding) || queryEmbedding.length !== EMBED_DIMS) {
    throw new Error(`Invalid query embedding dimensions: expected ${EMBED_DIMS}, got ${queryEmbedding?.length}`);
  }

  try {
    const float32Array = new Float32Array(queryEmbedding);
    const stmt = db.prepare(`
      SELECT 
        c.id as chunkId,
        c.library_item_id as libraryItemId,
        c.content as content,
        c.page_number as pageNumber,
        c.part_number as partNumber,
        v.distance as distance
      FROM library_chunk_vec v
      JOIN library_chunks c ON c.id = v.chunk_id
      WHERE v.embedding MATCH ?
      ORDER BY v.distance ASC
      LIMIT ?
    `);

    const rows = stmt.all(float32Array, limit) as {
      chunkId: string;
      libraryItemId: string;
      content: string;
      pageNumber: number | null;
      partNumber: number | null;
      distance: number;
    }[];

    return rows;
  } catch (err) {
    console.warn('[VectorSearch] sqlite-vec search failed, falling back to empty results or text match:', err);
    return [];
  }
}

/**
 * Inserts or replaces a chunk vector in library_chunk_vec.
 */
export function upsertChunkVector(
  db: SqliteDatabase,
  chunkId: string,
  embedding: number[],
): void {
  verifyEmbeddingModelLock(db);

  if (embedding.length !== EMBED_DIMS) {
    throw new Error(`Invalid embedding length: ${embedding.length}`);
  }

  const float32Array = new Float32Array(embedding);
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO library_chunk_vec (chunk_id, embedding)
    VALUES (?, ?)
  `);
  stmt.run(chunkId, float32Array);
}
