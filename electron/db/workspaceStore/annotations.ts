import type { SqliteDatabase } from '../open.js';
import { getCurrentUserId, genId } from './identity.js';
import type { AnnotationItem } from '../../../src/core/workspace/annotationService.js';

function mapAnnotationRow(r: any): AnnotationItem {
  return {
    id: r.id,
    document_id: r.document_id,
    user_id: r.user_id,
    anchor: JSON.parse(r.anchor || '{"quote":""}'),
    note: r.note || '',
    color: r.color,
    created_at: r.created_at,
  };
}

export function listAnnotations(db: SqliteDatabase, documentId: string): AnnotationItem[] {
  const rows = db.prepare('SELECT * FROM annotations WHERE document_id = ? ORDER BY created_at ASC').all(documentId) as any[];
  return rows.map(mapAnnotationRow);
}

export function createAnnotation(db: SqliteDatabase, item: Omit<AnnotationItem, 'id' | 'created_at'>): AnnotationItem {
  const userId = getCurrentUserId(db);
  const id = genId('ann');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO annotations (id, document_id, user_id, anchor, note, color, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, item.document_id, userId, JSON.stringify(item.anchor || {}), item.note || '', item.color || 'yellow', now);

  return { id, document_id: item.document_id, user_id: userId, anchor: item.anchor, note: item.note, color: item.color, created_at: now };
}

export function updateAnnotation(db: SqliteDatabase, id: string, updates: Partial<AnnotationItem>): AnnotationItem {
  const row = db.prepare('SELECT * FROM annotations WHERE id = ?').get(id) as any;
  if (!row) throw new Error(`Annotation ${id} not found`);

  const note = updates.note !== undefined ? updates.note : row.note;
  const color = updates.color !== undefined ? updates.color : row.color;
  // Mirrors cloudAnnotations.updateAnnotation: a passed anchor replaces the
  // stored one wholesale (e.g. isDetached flips true once the quote no
  // longer matches the live document) rather than being ignored.
  const anchor = updates.anchor !== undefined ? updates.anchor : JSON.parse(row.anchor || '{"quote":""}');

  db.prepare('UPDATE annotations SET note = ?, color = ?, anchor = ? WHERE id = ?')
    .run(note || '', color, JSON.stringify(anchor), id);

  return { id: row.id, document_id: row.document_id, user_id: row.user_id, anchor, note, color, created_at: row.created_at };
}

export function deleteAnnotation(db: SqliteDatabase, id: string): void {
  db.prepare('DELETE FROM annotations WHERE id = ?').run(id);
}
