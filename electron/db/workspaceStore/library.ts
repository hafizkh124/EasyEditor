import type { SqliteDatabase } from '../open.js';
import { getCurrentUserId, genId } from './identity.js';
import { deleteLibraryFile, writeLibraryFile } from '../fileStore.js';
import type { LibraryItem, LibraryItemKind } from '../../../src/core/workspace/types.js';

function mapLibraryItemRow(r: any): LibraryItem {
  return {
    id: r.id,
    user_id: r.user_id,
    project_id: r.project_id || undefined,
    kind: r.kind as LibraryItemKind,
    title: r.title,
    source_ref: JSON.parse(r.source_ref || '{}'),
    storage_path: r.storage_path || undefined,
    created_at: r.created_at,
    updated_at: r.updated_at || r.created_at,
    meta: JSON.parse(r.meta || '{}'),
  };
}

export function getItem(db: SqliteDatabase, id: string): LibraryItem | null {
  const userId = getCurrentUserId(db);
  const row = db.prepare('SELECT * FROM library_items WHERE user_id = ? AND id = ?').get(userId, id) as any;
  return row ? mapLibraryItemRow(row) : null;
}

export function listItems(db: SqliteDatabase, projectId?: string): LibraryItem[] {
  const userId = getCurrentUserId(db);
  const rows = (projectId
    ? db.prepare('SELECT * FROM library_items WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC').all(userId, projectId)
    : db.prepare('SELECT * FROM library_items WHERE user_id = ? ORDER BY created_at DESC').all(userId)) as any[];

  return rows.map(mapLibraryItemRow);
}

/** Largest upload accepted over IPC; the bytes cross the process boundary in one message. */
export const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;

/**
 * The storage_path for an uploaded file: `<itemId>/<file name>`. The name keeps its
 * extension (ingest picks the text extractor from it) but never a directory part,
 * and `..` / empty names collapse to a safe placeholder — fileStore also refuses
 * anything that escapes its root, this just avoids producing such a path at all.
 */
export function storagePathForUpload(id: string, nameHint: string): string {
  const base = nameHint.replace(/\\/g, '/').split('/').pop() ?? '';
  // keep the TAIL if it must be shortened, so the extension survives
  // eslint-disable-next-line no-control-regex -- control characters are exactly what a safe filename must not contain
  let name = base.replace(/[<>:"|?*\u0000-\u001f]/g, '_').trim().slice(-120);
  if (!name || /^\.+$/.test(name)) name = 'file';
  return `${id}/${name}`;
}

/**
 * Creates a library item. When `bytes` is given (a desktop upload) the file is stored
 * under userData/files first and the item points at it — without this the renderer
 * created an item that named a file nobody ever wrote, so every ingest ended in
 * "[Could not read file]".
 */
export function createItem(
  db: SqliteDatabase,
  item: Partial<LibraryItem> & { title: string },
  bytes?: Uint8Array | ArrayBuffer,
): LibraryItem {
  const userId = getCurrentUserId(db);
  const id = item.id || genId('lib');
  const now = new Date().toISOString();
  const kind = item.kind || 'note';
  const sourceRef = item.source_ref || {};
  const meta = item.meta || {};

  let storagePath = item.storage_path;
  if (bytes) {
    const size = bytes.byteLength;
    if (size > MAX_UPLOAD_BYTES) {
      throw new Error(`File is too large (${Math.round(size / 1048576)} MB; the limit is ${MAX_UPLOAD_BYTES / 1048576} MB)`);
    }
    storagePath = writeLibraryFile(storagePathForUpload(id, item.storage_path || item.title), Buffer.from(bytes as ArrayBuffer));
  }

  try {
    db.prepare(`
      INSERT INTO library_items (id, user_id, project_id, kind, title, source_ref, storage_path, meta, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, item.project_id || null, kind, item.title, JSON.stringify(sourceRef), storagePath || null, JSON.stringify(meta), now, now);
  } catch (err) {
    // Do not leave an orphan file behind an item that was never created.
    if (bytes && storagePath) deleteLibraryFile(storagePath);
    throw err;
  }

  return {
    id, user_id: userId, project_id: item.project_id, kind, title: item.title,
    source_ref: sourceRef, storage_path: storagePath, created_at: now, meta,
  };
}

/**
 * Mirrors cloudLibrary.deleteLibraryItem: removes vectors, chunks (FK cascade)
 * and the item row — and now the stored file too (FR-4.6). Leaving the
 * original PDF on disk after the user deleted the book would be exactly the
 * quiet retention local mode exists to avoid.
 */
export function deleteItem(db: SqliteDatabase, id: string): void {
  const row = db.prepare('SELECT storage_path FROM library_items WHERE id = ?').get(id) as
    | { storage_path: string | null }
    | undefined;

  db.prepare('DELETE FROM library_chunk_vec WHERE chunk_id IN (SELECT id FROM library_chunks WHERE library_item_id = ?)').run(id);
  db.prepare('DELETE FROM library_chunk_embeddings WHERE chunk_id IN (SELECT id FROM library_chunks WHERE library_item_id = ?)').run(id);
  db.prepare('DELETE FROM library_chunks_fts WHERE library_item_id = ?').run(id);
  db.prepare('DELETE FROM library_items WHERE id = ?').run(id);

  if (row?.storage_path) deleteLibraryFile(row.storage_path);
}

export interface LibraryChunkRow {
  id: string;
  chunk_index: number;
  content: string;
  char_start: number;
  char_end: number;
  page_number: number | null;
  part_number: number | null;
  meta: Record<string, unknown>;
  created_at: string;
}

/** Upper bound for one listChunks page — a book can hold tens of thousands of chunks. */
const MAX_CHUNK_PAGE = 200;

/** Chunk meta is JSON text; one corrupt row must not take down the whole listing. */
function parseChunkMeta(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function listChunks(
  db: SqliteDatabase,
  itemId: string,
  limit = 50,
  offset = 0,
): LibraryChunkRow[] {
  const take = Math.min(Math.max(1, Math.trunc(limit) || 50), MAX_CHUNK_PAGE);
  const skip = Math.max(0, Math.trunc(offset) || 0);
  const userId = getCurrentUserId(db);
  const rows = db.prepare(`
    SELECT id, chunk_index, content, char_start, char_end, page_number, part_number, meta, created_at
    FROM library_chunks
    WHERE user_id = ? AND library_item_id = ?
    ORDER BY chunk_index ASC
    LIMIT ? OFFSET ?
  `).all(userId, itemId, take, skip) as any[];

  return rows.map((r) => ({
    id: r.id,
    chunk_index: r.chunk_index,
    content: r.content,
    char_start: r.char_start,
    char_end: r.char_end,
    page_number: r.page_number ?? null,
    part_number: r.part_number ?? null,
    meta: parseChunkMeta(r.meta),
    created_at: r.created_at,
  }));
}
