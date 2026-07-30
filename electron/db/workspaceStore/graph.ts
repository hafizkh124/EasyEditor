import type { SqliteDatabase } from '../open.js';
import { getCurrentUserId, genId } from './identity.js';
import type { Entity, EntityRelation, EntityBacklink, EntityDetails } from '../../../src/lib/graph/graphService.js';

function mapEntityRow(r: any): Entity {
  return {
    id: r.id,
    user_id: r.user_id,
    canonical_name: r.canonical_name,
    kind: r.kind,
    aliases: JSON.parse(r.aliases || '[]'),
    summary: r.summary || undefined,
    created_at: r.created_at,
  };
}

export function listEntities(db: SqliteDatabase): Entity[] {
  const userId = getCurrentUserId(db);
  const rows = db.prepare('SELECT * FROM entities WHERE user_id = ? ORDER BY canonical_name ASC').all(userId) as any[];
  return rows.map(mapEntityRow);
}

export function createEntity(db: SqliteDatabase, entity: Omit<Entity, 'id' | 'created_at'>): Entity {
  const userId = getCurrentUserId(db);
  const id = genId('ent');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO entities (id, user_id, canonical_name, kind, aliases, summary, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, entity.canonical_name, entity.kind, JSON.stringify(entity.aliases || []), entity.summary || null, now);

  return { id, ...entity, user_id: userId, created_at: now };
}

function mapRelationRow(r: any, related: Map<string, Entity>): EntityRelation {
  return {
    id: r.id,
    user_id: r.user_id,
    source_entity_id: r.source_entity_id,
    target_entity_id: r.target_entity_id,
    relation_type: r.relation_type,
    evidence_quote: r.evidence_quote || undefined,
    document_id: r.document_id || undefined,
    library_item_id: r.library_item_id || undefined,
    created_at: r.created_at,
    source_entity: related.get(r.source_entity_id),
    target_entity: related.get(r.target_entity_id),
  };
}

/** Mirrors cloudGraph.getEntityDetails: relations both ways, plus backlinks (SPEC-M4 FR-3.4). */
export function getEntityDetails(db: SqliteDatabase, entityId: string): EntityDetails | null {
  const entityRow = db.prepare('SELECT * FROM entities WHERE id = ?').get(entityId) as any;
  if (!entityRow) return null;
  const entity = mapEntityRow(entityRow);

  const outgoingRows = db.prepare('SELECT * FROM entity_relations WHERE source_entity_id = ?').all(entityId) as any[];
  const incomingRows = db.prepare('SELECT * FROM entity_relations WHERE target_entity_id = ?').all(entityId) as any[];

  const relatedIds = new Set<string>();
  for (const r of outgoingRows) relatedIds.add(r.target_entity_id);
  for (const r of incomingRows) relatedIds.add(r.source_entity_id);

  const related = new Map<string, Entity>();
  if (relatedIds.size > 0) {
    const ids = [...relatedIds];
    const placeholders = ids.map(() => '?').join(',');
    const rows = db.prepare(`SELECT * FROM entities WHERE id IN (${placeholders})`).all(...ids) as any[];
    for (const r of rows) related.set(r.id, mapEntityRow(r));
  }

  const outgoingRelations = outgoingRows.map((r) => mapRelationRow(r, related));
  const incomingRelations = incomingRows.map((r) => mapRelationRow(r, related));

  const allRelationRows = [...outgoingRows, ...incomingRows];
  const docIds = [...new Set(allRelationRows.map((r) => r.document_id).filter(Boolean))] as string[];
  const libIds = [...new Set(allRelationRows.map((r) => r.library_item_id).filter(Boolean))] as string[];

  const backlinks: EntityBacklink[] = [];
  if (docIds.length > 0) {
    const placeholders = docIds.map(() => '?').join(',');
    const docs = db.prepare(`SELECT id, title FROM documents WHERE id IN (${placeholders})`).all(...docIds) as any[];
    for (const d of docs) backlinks.push({ id: d.id, type: 'document', title: d.title || 'Untitled Document' });
  }
  if (libIds.length > 0) {
    const placeholders = libIds.map(() => '?').join(',');
    const libs = db.prepare(`SELECT id, title FROM library_items WHERE id IN (${placeholders})`).all(...libIds) as any[];
    for (const l of libs) backlinks.push({ id: l.id, type: 'library_item', title: l.title || 'Untitled File' });
  }

  return { entity, outgoingRelations, incomingRelations, backlinks };
}

/**
 * Mirrors cloudGraph.mergeEntities: absorbId's relations are repointed to
 * keepId (not deleted — the evidence stays intact) and mergedAliases
 * replaces keepId's alias list, before absorbId itself is deleted. All in
 * one transaction so a mid-merge crash can't leave relations pointing at a
 * deleted entity.
 */
export function mergeEntities(db: SqliteDatabase, keepId: string, absorbId: string, mergedAliases: string[]): boolean {
  if (keepId === absorbId) return false;

  const run = db.transaction(() => {
    db.prepare('UPDATE entities SET aliases = ? WHERE id = ?').run(JSON.stringify(mergedAliases), keepId);
    db.prepare('UPDATE entity_relations SET source_entity_id = ? WHERE source_entity_id = ?').run(keepId, absorbId);
    db.prepare('UPDATE entity_relations SET target_entity_id = ? WHERE target_entity_id = ?').run(keepId, absorbId);
    db.prepare('DELETE FROM entities WHERE id = ?').run(absorbId);
  });
  run();
  return true;
}
