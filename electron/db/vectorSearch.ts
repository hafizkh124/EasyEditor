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
      `مقامی کتب خانے کے vectors "${storedModel}" سے بنے ہیں مگر تلاش "${currentModel}" استعمال کر رہی ہے۔ ` +
      `دونوں مختلف vector spaces ہیں، اس لیے تلاش کا نتیجہ بے معنی ہوگا۔ کتب خانہ دوبارہ ingest کریں۔`,
    );
    this.name = 'EmbeddingModelMismatchError';
  }
}

/**
 * Checks that the stored embedding model (and its dimensionality) in
 * corpus_meta matches EMBED_MODEL/EMBED_DIMS.
 *
 * Fail-closed: a missing corpus_meta row is NOT treated as a match. A fresh
 * or corrupted database must not silently pass this check (SPEC-M5 FR-3.5,
 * risk R3) — a query embedded into the wrong vector space returns nothing,
 * with no error, unless this function refuses first.
 */
export function verifyEmbeddingModelLock(db: SqliteDatabase): void {
  const modelRow = db.prepare("SELECT value FROM corpus_meta WHERE key = 'embed_model'").get() as { value: string } | undefined;
  if (!modelRow) {
    throw new EmbeddingModelMismatchError('(کوئی درج نہیں)', EMBED_MODEL);
  }
  if (modelRow.value !== EMBED_MODEL) {
    throw new EmbeddingModelMismatchError(modelRow.value, EMBED_MODEL);
  }

  const dimsRow = db.prepare("SELECT value FROM corpus_meta WHERE key = 'embed_dims'").get() as { value: string } | undefined;
  if (!dimsRow || Number(dimsRow.value) !== EMBED_DIMS) {
    throw new EmbeddingModelMismatchError(`dims=${dimsRow?.value ?? '؟'}`, `dims=${EMBED_DIMS}`);
  }
}

/**
 * FR-4.3: hard ceiling on the JS brute-force fallback. Beyond this row count
 * a per-query O(n) cosine scan is not "slow", it is unusable — refuse with a
 * clear reason rather than let the app appear to hang.
 */
const BRUTE_FORCE_MAX_ROWS = 20_000;

function vecSearch(
  db: SqliteDatabase,
  float32Array: Float32Array,
  limit: number,
): VectorSearchResult[] {
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

  return stmt.all(float32Array, limit) as VectorSearchResult[];
}

function cosineDistance(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 1;
  return 1 - dot / denom;
}

/**
 * FR-4.3 fallback: JS-side brute-force cosine search, used only when the
 * sqlite-vec extension failed to load. Reads from library_chunk_embeddings
 * (a plain table kept in sync alongside the vec0 virtual table — see
 * upsertChunkVector) rather than from vec0, since vec0 itself is what is
 * unavailable in this code path.
 */
function bruteForceCosineSearch(
  db: SqliteDatabase,
  queryEmbedding: number[],
  limit: number,
): VectorSearchResult[] {
  const countRow = db.prepare('SELECT COUNT(*) as n FROM library_chunk_embeddings').get() as { n: number };
  if (countRow.n > BRUTE_FORCE_MAX_ROWS) {
    throw new Error(
      `sqlite-vec لوڈ نہیں ہو سکی اور مقامی کتب خانے میں ${countRow.n} chunks ہیں (حد ${BRUTE_FORCE_MAX_ROWS})۔ ` +
      `اس پیمانے پر JS کی تلاش ناقابلِ استعمال حد تک سست ہوگی۔ ایپ دوبارہ انسٹال کریں یا معاونت سے رابطہ کریں۔`,
    );
  }

  const rows = db.prepare(`
    SELECT
      e.chunk_id as chunkId,
      e.embedding as embedding,
      c.library_item_id as libraryItemId,
      c.content as content,
      c.page_number as pageNumber,
      c.part_number as partNumber
    FROM library_chunk_embeddings e
    JOIN library_chunks c ON c.id = e.chunk_id
  `).all() as {
    chunkId: string;
    embedding: Buffer;
    libraryItemId: string;
    content: string;
    pageNumber: number | null;
    partNumber: number | null;
  }[];

  const queryVec = new Float32Array(queryEmbedding);
  const scored = rows.map((r) => {
    const storedVec = new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4);
    return {
      chunkId: r.chunkId,
      libraryItemId: r.libraryItemId,
      content: r.content,
      pageNumber: r.pageNumber,
      partNumber: r.partNumber,
      distance: cosineDistance(queryVec, storedVec),
    };
  });

  scored.sort((a, b) => a.distance - b.distance);
  return scored.slice(0, limit);
}

/**
 * Searches local library chunks by vector distance.
 *
 * ⛔ Never returns an empty array to signal failure (SPEC-M5 FR-3.5/FR-4.3,
 * risk R3/R25): sqlite-vec unavailability falls back to a brute-force scan
 * (bounded by BRUTE_FORCE_MAX_ROWS, which throws past that ceiling); any
 * other failure propagates as a thrown error for the caller to surface.
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

  const float32Array = new Float32Array(queryEmbedding);

  try {
    return vecSearch(db, float32Array, limit);
  } catch (err) {
    console.warn('[VectorSearch] sqlite-vec unavailable, using brute-force fallback:', err);
    return bruteForceCosineSearch(db, queryEmbedding, limit);
  }
}

/**
 * Inserts or replaces a chunk vector in both the sqlite-vec virtual table
 * AND the plain library_chunk_embeddings table that backs the brute-force
 * fallback above. The two are kept in sync so a search made while sqlite-vec
 * is unavailable still has data to scan.
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

  try {
    db.prepare(`
      INSERT OR REPLACE INTO library_chunk_vec (chunk_id, embedding)
      VALUES (?, ?)
    `).run(chunkId, float32Array);
  } catch (err) {
    console.warn('[VectorSearch] sqlite-vec unavailable, storing in fallback table only:', err);
  }

  db.prepare(`
    INSERT OR REPLACE INTO library_chunk_embeddings (chunk_id, embedding)
    VALUES (?, ?)
  `).run(chunkId, Buffer.from(float32Array.buffer, float32Array.byteOffset, float32Array.byteLength));
}
