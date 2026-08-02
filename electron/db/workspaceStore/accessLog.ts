import type { SqliteDatabase } from '../open.js';
import { getCurrentUserId } from './identity.js';

export interface RecentItem {
  itemId: string;
  accessedAt: string;
  title: string;
  kind: string;
  sourceRef: Record<string, unknown>;
  meta: Record<string, unknown>;
  totalPages?: number;
}

/**
 * Record that a library item was accessed (for Home screen recent books).
 * Uses INSERT OR REPLACE to update the timestamp if the item was already accessed.
 */
export function accessItem(db: SqliteDatabase, itemId: string): void {
  const userId = getCurrentUserId(db);
  const now = new Date().toISOString();

  // Upsert: update timestamp if already exists, insert if not
  const existing = db.prepare(
    'SELECT id FROM document_access_log WHERE user_id = ? AND item_id = ?'
  ).get(userId, itemId) as { id: number } | undefined;

  if (existing) {
    db.prepare(
      'UPDATE document_access_log SET accessed_at = ? WHERE id = ?'
    ).run(now, existing.id);
  } else {
    db.prepare(
      'INSERT INTO document_access_log (user_id, item_id, accessed_at) VALUES (?, ?, ?)'
    ).run(userId, itemId, now);
  }
}

/**
 * Get recently accessed library items for the Home screen.
 * Returns items ordered by last access time, most recent first.
 */
export function getRecentItems(db: SqliteDatabase, limit = 10): RecentItem[] {
  const userId = getCurrentUserId(db);
  const rows = db.prepare(`
    SELECT
      al.item_id as itemId,
      al.accessed_at as accessedAt,
      li.title,
      li.kind,
      li.source_ref as sourceRef,
      li.meta,
      (SELECT COUNT(*) FROM library_chunks WHERE library_item_id = li.id) as totalPages
    FROM document_access_log al
    JOIN library_items li ON al.item_id = li.id
    WHERE al.user_id = ?
    ORDER BY al.accessed_at DESC
    LIMIT ?
  `).all(userId, limit) as any[];

  return rows.map((r) => ({
    itemId: r.itemId,
    accessedAt: r.accessedAt,
    title: r.title,
    kind: r.kind,
    sourceRef: JSON.parse(r.sourceRef || '{}'),
    meta: JSON.parse(r.meta || '{}'),
    totalPages: r.totalPages || undefined,
  }));
}

/**
 * Get total count of library items.
 */
export function getLibraryItemCount(db: SqliteDatabase): number {
  const userId = getCurrentUserId(db);
  const row = db.prepare(
    'SELECT COUNT(*) as count FROM library_items WHERE user_id = ?'
  ).get(userId) as { count: number };
  return row?.count ?? 0;
}
