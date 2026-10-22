import { randomUUID } from 'node:crypto';
import type { SqliteDatabase } from '../open.js';
import { getCurrentUserId } from './identity.js';

/**
 * Plan §3.5 — the offline mirror of Supabase `research_sessions` /
 * `user_sessions`, so a logged-out desktop scholar's chat is never lost.
 * Column names match Postgres verbatim (FR-4.2).
 */

export interface LocalResearchSession {
  id: string;
  title: string;
  mode: string;
  messages: unknown[];
  citations: unknown[];
  selected_domains: string[];
  project_id: string | null;
  updated_at: string;
}

export interface LocalResearchSummary {
  id: string;
  title: string;
  mode: string;
  project_id: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
}

function parse<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

export function upsertResearchSession(
  db: SqliteDatabase,
  p: { id: string | null; title: string; mode: string; messages: unknown[]; citations: unknown[]; selectedDomains: string[]; projectId?: string | null },
): string {
  const userId = getCurrentUserId(db);
  const now = new Date().toISOString();
  const id = p.id ?? randomUUID();
  const existing = p.id
    ? (db.prepare('SELECT id FROM research_sessions WHERE id = ? AND user_id = ?').get(p.id, userId) as { id: string } | undefined)
    : undefined;

  // A chat keeps the folder it was started in: an update only sets it when
  // one is given, never clears it.
  if (existing) {
    db.prepare(
      'UPDATE research_sessions SET title = ?, mode = ?, messages = ?, citations = ?, selected_domains = ?, project_id = COALESCE(?, project_id), updated_at = ? WHERE id = ? AND user_id = ?',
    ).run(p.title, p.mode, JSON.stringify(p.messages), JSON.stringify(p.citations), JSON.stringify(p.selectedDomains), p.projectId ?? null, now, id, userId);
  } else {
    db.prepare(
      'INSERT INTO research_sessions (id, user_id, title, mode, messages, citations, selected_domains, project_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ).run(id, userId, p.title, p.mode, JSON.stringify(p.messages), JSON.stringify(p.citations), JSON.stringify(p.selectedDomains), p.projectId ?? null, now, now);
  }
  return id;
}

export function loadResearchSession(db: SqliteDatabase, id: string): LocalResearchSession | null {
  const userId = getCurrentUserId(db);
  const row = db.prepare('SELECT id, title, mode, messages, citations, selected_domains, project_id, updated_at FROM research_sessions WHERE id = ? AND user_id = ?').get(id, userId) as
    | { id: string; title: string; mode: string; messages: string; citations: string; selected_domains: string; project_id: string | null; updated_at: string }
    | undefined;
  if (!row) return null;
  return {
    id: row.id, title: row.title, mode: row.mode, updated_at: row.updated_at, project_id: row.project_id ?? null,
    messages: parse(row.messages, []), citations: parse(row.citations, []),
    selected_domains: parse(row.selected_domains, []),
  };
}

export function loadLatestResearchSession(db: SqliteDatabase, mode: string): LocalResearchSession | null {
  const userId = getCurrentUserId(db);
  const row = db.prepare('SELECT id FROM research_sessions WHERE user_id = ? AND mode = ? ORDER BY updated_at DESC LIMIT 1').get(userId, mode) as { id: string } | undefined;
  return row ? loadResearchSession(db, row.id) : null;
}

export function listResearchSessions(db: SqliteDatabase, limit = 50): LocalResearchSummary[] {
  const userId = getCurrentUserId(db);
  const rows = db.prepare('SELECT id, title, mode, messages, project_id, created_at, updated_at FROM research_sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?').all(userId, limit) as Array<{
    id: string; title: string; mode: string; messages: string; project_id: string | null; created_at: string; updated_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id, title: r.title ?? 'Untitled', mode: r.mode ?? 'islamic', updated_at: r.updated_at,
    created_at: r.created_at, project_id: r.project_id ?? null,
    message_count: parse<unknown[]>(r.messages, []).length,
  }));
}

export function deleteResearchSession(db: SqliteDatabase, id: string): void {
  db.prepare('DELETE FROM research_sessions WHERE id = ? AND user_id = ?').run(id, getCurrentUserId(db));
}
