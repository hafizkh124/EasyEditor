import type { SqliteDatabase } from '../open.js';
import { getCurrentUserId } from './identity.js';

/**
 * Plan §4.6 — the offline store for a resumable per-book / per-author batch
 * agent run. Desktop-only; there is no Supabase mirror.
 */

export interface BatchRunRow {
  id: string;
  instruction: string;
  scopeJson: string;
  granularity: string;
  aggregate: string;
  itemsTotal: number;
  itemsDone: unknown[];
  status: string;
  updatedAt: string;
}

function parse<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

export function createBatchRun(
  db: SqliteDatabase,
  p: { id: string; instruction: string; scopeJson: string; granularity: string; aggregate: string; itemsTotal: number },
): void {
  const userId = getCurrentUserId(db);
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO batch_runs (id, user_id, instruction, scope_json, granularity, aggregate, items_total, items_done_json, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  ).run(p.id, userId, p.instruction, p.scopeJson, p.granularity, p.aggregate, p.itemsTotal, '[]', 'running', now, now);
}

export function updateBatchRun(
  db: SqliteDatabase,
  id: string,
  updates: { itemsDone?: unknown[]; status?: string },
): void {
  const userId = getCurrentUserId(db);
  const now = new Date().toISOString();
  const row = db.prepare('SELECT items_done_json, status FROM batch_runs WHERE id = ? AND user_id = ?').get(id, userId) as
    | { items_done_json: string; status: string }
    | undefined;
  if (!row) return;
  db.prepare('UPDATE batch_runs SET items_done_json = ?, status = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(
    updates.itemsDone ? JSON.stringify(updates.itemsDone) : row.items_done_json,
    updates.status ?? row.status,
    now,
    id,
    userId,
  );
}

export function loadBatchRun(db: SqliteDatabase, id: string): BatchRunRow | null {
  const userId = getCurrentUserId(db);
  const row = db
    .prepare('SELECT id, instruction, scope_json, granularity, aggregate, items_total, items_done_json, status, updated_at FROM batch_runs WHERE id = ? AND user_id = ?')
    .get(id, userId) as
    | { id: string; instruction: string; scope_json: string; granularity: string; aggregate: string; items_total: number; items_done_json: string; status: string; updated_at: string }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    instruction: row.instruction,
    scopeJson: row.scope_json,
    granularity: row.granularity,
    aggregate: row.aggregate,
    itemsTotal: row.items_total,
    itemsDone: parse<unknown[]>(row.items_done_json, []),
    status: row.status,
    updatedAt: row.updated_at,
  };
}

/** The most recent batch that never reached `done` — surfaces the resume button. */
export function latestUnfinishedBatchRun(db: SqliteDatabase): BatchRunRow | null {
  const userId = getCurrentUserId(db);
  const row = db
    .prepare("SELECT id FROM batch_runs WHERE user_id = ? AND status != 'done' ORDER BY updated_at DESC LIMIT 1")
    .get(userId) as { id: string } | undefined;
  return row ? loadBatchRun(db, row.id) : null;
}

export function deleteBatchRun(db: SqliteDatabase, id: string): void {
  db.prepare('DELETE FROM batch_runs WHERE id = ? AND user_id = ?').run(id, getCurrentUserId(db));
}
