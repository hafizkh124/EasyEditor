import type { SqliteDatabase } from '../open.js';
import { getCurrentUserId, genId } from './identity.js';
import { deleteLibraryFile } from '../fileStore.js';
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
    meta: JSON.parse(r.meta || '{}'),
  };
}

export function listItems(db: SqliteDatabase, projectId?: string): LibraryItem[] {
  const userId = getCurrentUserId(db);
  const rows = (projectId
    ? db.prepare('SELECT * FROM library_items WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC').all(userId, projectId)
    : db.prepare('SELECT * FROM library_items WHERE user_id = ? ORDER BY created_at DESC').all(userId)) as any[];

  return rows.map(mapLibraryItemRow);
}

export function createItem(db: SqliteDatabase, item: Partial<LibraryItem> & { title: string }): LibraryItem {
  const userId = getCurrentUserId(db);
  const id = item.id || genId('lib');
  const now = new Date().toISOString();
  const kind = item.kind || 'note';
  const sourceRef = item.source_ref || {};
  const meta = item.meta || {};

  db.prepare(`
    INSERT INTO library_items (id, user_id, project_id, kind, title, source_ref, storage_path, meta, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, item.project_id || null, kind, item.title, JSON.stringify(sourceRef), item.storage_path || null, JSON.stringify(meta), now);

  return {
    id, user_id: userId, project_id: item.project_id, kind, title: item.title,
    source_ref: sourceRef, storage_path: item.storage_path, created_at: now, meta,
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
  db.prepare('DELETE FROM library_items WHERE id = ?').run(id);

  if (row?.storage_path) deleteLibraryFile(row.storage_path);
}
