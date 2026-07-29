import type { SqliteDatabase } from '../open.js';
import { getCurrentUserId, genId } from './identity.js';
import { getTaskBySlug } from '../../../src/lib/tasks/registry.js';
import type { CustomTaskRow } from '../../../src/lib/tasks/customTasks.js';

function mapRow(r: any): CustomTaskRow {
  return {
    id: r.id,
    user_id: r.user_id,
    slug: r.slug,
    label: r.label,
    system_prompt: r.system_prompt,
    base_task_slug: r.base_task_slug || null,
    scope: r.scope,
    apply_mode: r.apply_mode,
    output_format: r.output_format,
    chunkable: !!r.chunkable,
    produces_sources: !!r.produces_sources,
    archived_at: r.archived_at || null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/** Mirrors cloudCustomTasks's toSlug: a stable, unique-per-user key from a user-supplied label. */
function toSlug(label: string, fallback: string): string {
  const base = label.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  return (base || fallback).slice(0, 48);
}

export function list(db: SqliteDatabase): CustomTaskRow[] {
  const userId = getCurrentUserId(db);
  const rows = db.prepare('SELECT * FROM ai_tasks WHERE user_id = ? AND archived_at IS NULL ORDER BY created_at ASC').all(userId) as any[];
  return rows.map(mapRow);
}

/**
 * Mirrors cloudCustomTasks.createFromBuiltin: copies a built-in task's
 * behaviour flags (scope/applyMode/chunkable/producesSources) so a custom
 * "citations" variant stays chunkable and source-producing, letting the user
 * supply only the label and prompt.
 */
export function createFromBuiltin(db: SqliteDatabase, baseSlug: string, label: string, systemPrompt: string): CustomTaskRow {
  const base = getTaskBySlug(baseSlug);
  if (!base) throw new Error(`بنیادی ٹاسک '${baseSlug}' موجود نہیں۔`);

  const userId = getCurrentUserId(db);
  const id = genId('ctask');
  const now = new Date().toISOString();
  const slug = toSlug(label, `${baseSlug}-copy-${Date.now().toString(36)}`);
  const trimmedLabel = label.trim();
  const trimmedPrompt = systemPrompt.trim();
  const outputFormat = base.outputFormat ?? 'text';

  try {
    db.prepare(`
      INSERT INTO ai_tasks (id, user_id, slug, label, system_prompt, base_task_slug, scope, apply_mode, output_format, chunkable, produces_sources, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, userId, slug, trimmedLabel, trimmedPrompt, baseSlug,
      base.scope, base.applyMode, outputFormat,
      base.chunkable ? 1 : 0, base.producesSources ? 1 : 0, now, now,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('UNIQUE')) {
      throw new Error('اس نام کا ٹاسک پہلے سے موجود ہے — کوئی اور نام رکھیں۔');
    }
    throw new Error('ٹاسک محفوظ نہ ہو سکا۔');
  }

  return {
    id, user_id: userId, slug, label: trimmedLabel, system_prompt: trimmedPrompt,
    base_task_slug: baseSlug, scope: base.scope, apply_mode: base.applyMode,
    output_format: outputFormat, chunkable: base.chunkable,
    produces_sources: base.producesSources, archived_at: null, created_at: now, updated_at: now,
  };
}

export function update(db: SqliteDatabase, id: string, patch: { label?: string; system_prompt?: string }): boolean {
  const row = db.prepare('SELECT * FROM ai_tasks WHERE id = ?').get(id) as any;
  if (!row) return false;

  const now = new Date().toISOString();
  const label = patch.label !== undefined ? patch.label : row.label;
  const systemPrompt = patch.system_prompt !== undefined ? patch.system_prompt : row.system_prompt;

  db.prepare('UPDATE ai_tasks SET label = ?, system_prompt = ?, updated_at = ? WHERE id = ?').run(label, systemPrompt, now, id);
  return true;
}

/** Archive rather than delete, so old task_runs keep a resolvable name. */
export function archive(db: SqliteDatabase, id: string): boolean {
  const now = new Date().toISOString();
  const result = db.prepare('UPDATE ai_tasks SET archived_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
  return result.changes > 0;
}
