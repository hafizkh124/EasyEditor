import { randomUUID } from 'node:crypto';
import type { SqliteDatabase } from '../open.js';
import { getCurrentUserId } from './identity.js';

/** Plan §3.4 — the offline search log. */
export interface SearchHistoryRow {
  id: string;
  kind: string;
  query: string;
  filters: Record<string, unknown>;
  resultCount: number | null;
  createdAt: string;
}

const DEDUP_WINDOW_MS = 30_000;

export function addSearch(
  db: SqliteDatabase,
  entry: { kind: string; query: string; filters?: Record<string, unknown>; resultCount?: number | null },
): void {
  const userId = getCurrentUserId(db);
  const now = Date.now();
  const q = entry.query.trim();
  if (!q) return;

  // Skip a near-duplicate of the last matching search within the window.
  const last = db
    .prepare('SELECT created_at FROM search_history WHERE user_id = ? AND kind = ? AND query = ? ORDER BY created_at DESC LIMIT 1')
    .get(userId, entry.kind, q) as { created_at: string } | undefined;
  if (last && now - new Date(last.created_at).getTime() < DEDUP_WINDOW_MS) {
    db.prepare('UPDATE search_history SET created_at = ?, result_count = ? WHERE user_id = ? AND kind = ? AND query = ? AND created_at = ?')
      .run(new Date(now).toISOString(), entry.resultCount ?? null, userId, entry.kind, q, last.created_at);
    return;
  }

  db.prepare('INSERT INTO search_history (id, user_id, kind, query, filters, result_count, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(randomUUID(), userId, entry.kind, q, JSON.stringify(entry.filters ?? {}), entry.resultCount ?? null, new Date(now).toISOString());
}

export function listSearches(db: SqliteDatabase, limit = 60): SearchHistoryRow[] {
  const userId = getCurrentUserId(db);
  const rows = db
    .prepare('SELECT id, kind, query, filters, result_count, created_at FROM search_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, limit) as Array<{ id: string; kind: string; query: string; filters: string; result_count: number | null; created_at: string }>;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    query: r.query,
    filters: safeParse(r.filters),
    resultCount: r.result_count,
    createdAt: r.created_at,
  }));
}

export function removeSearch(db: SqliteDatabase, id: string): void {
  db.prepare('DELETE FROM search_history WHERE user_id = ? AND id = ?').run(getCurrentUserId(db), id);
}

export function clearSearches(db: SqliteDatabase): void {
  db.prepare('DELETE FROM search_history WHERE user_id = ?').run(getCurrentUserId(db));
}

function safeParse(s: string): Record<string, unknown> {
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return {}; }
}
