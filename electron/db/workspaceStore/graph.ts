import type { SqliteDatabase } from '../open.js';
import { getCurrentUserId, genId } from './identity.js';
import type { Entity } from '../../../src/lib/graph/graphService.js';

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
