import type { SqliteDatabase } from '../open.js';
import { getCurrentUserId, genId } from './identity.js';
import type { TaskRun, TaskRunStatus } from '../../../src/core/workspace/types.js';

function mapTaskRunRow(r: any): TaskRun {
  return {
    id: r.id,
    user_id: r.user_id,
    project_id: r.project_id || undefined,
    document_id: r.document_id || undefined,
    task_slug: r.task_slug,
    status: r.status as TaskRunStatus,
    input: JSON.parse(r.input || '{}'),
    output: JSON.parse(r.output || '{}'),
    sources: JSON.parse(r.sources || '[]'),
    confidence: r.confidence ?? undefined,
    model: r.model || undefined,
    tokens_spent: r.tokens_spent ?? undefined,
    progress: JSON.parse(r.progress || '{}'),
    error: r.error || undefined,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export function listTaskRuns(db: SqliteDatabase, documentId?: string): TaskRun[] {
  const userId = getCurrentUserId(db);
  const rows = (documentId
    ? db.prepare('SELECT * FROM task_runs WHERE user_id = ? AND document_id = ? ORDER BY created_at DESC').all(userId, documentId)
    : db.prepare('SELECT * FROM task_runs WHERE user_id = ? ORDER BY created_at DESC').all(userId)) as any[];

  return rows.map(mapTaskRunRow);
}

export function createTaskRun(db: SqliteDatabase, run: Omit<TaskRun, 'id' | 'created_at' | 'updated_at'>): TaskRun {
  const userId = getCurrentUserId(db);
  const id = genId('trun');
  const now = new Date().toISOString();
  const status = run.status || 'pending';

  db.prepare(`
    INSERT INTO task_runs (id, user_id, project_id, document_id, task_slug, status, input, output, sources, model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, '{}', '[]', ?, ?, ?)
  `).run(id, userId, run.project_id || null, run.document_id || null, run.task_slug, status, JSON.stringify(run.input || {}), run.model || null, now, now);

  return { id, ...run, user_id: userId, status, created_at: now, updated_at: now };
}

export function updateTaskRunStatus(
  db: SqliteDatabase,
  id: string,
  status: TaskRunStatus,
  outputJson?: Record<string, unknown>,
  error?: string,
): TaskRun {
  const row = db.prepare('SELECT * FROM task_runs WHERE id = ?').get(id) as any;
  if (!row) throw new Error(`Task run ${id} not found`);

  const now = new Date().toISOString();
  const outStr = outputJson ? JSON.stringify(outputJson) : row.output;

  db.prepare('UPDATE task_runs SET status = ?, output = ?, error = ?, updated_at = ? WHERE id = ?')
    .run(status, outStr, error || null, now, id);

  return mapTaskRunRow({ ...row, status, output: outStr, error: error || null, updated_at: now });
}
