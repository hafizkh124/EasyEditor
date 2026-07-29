import type { SqliteDatabase } from './open.js';
import type {
  Project,
  ProjectKind,
  Document,
  DocumentStatus,
  DocumentVersion,
  LibraryItem,
  LibraryItemKind,
  TaskRun,
  TaskRunStatus,
} from '../../src/core/workspace/types.js';
import type { AnnotationItem } from '../../src/core/workspace/annotationService.js';
import type { Entity } from '../../src/lib/graph/graphService.js';

export class WorkspaceDbService {
  constructor(private db: SqliteDatabase) {}

  // ── Identity ──────────────────────────────────────────────────────────────

  public async getCurrentUserId(): Promise<string> {
    const row = this.db.prepare("SELECT value FROM corpus_meta WHERE key = 'local_user_id'").get() as { value: string } | undefined;
    return row?.value || 'local-user-default';
  }

  // ── Projects ──────────────────────────────────────────────────────────────

  public async listProjects(): Promise<Project[]> {
    const userId = await this.getCurrentUserId();
    const rows = this.db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as any[];
    return rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      title: r.title,
      kind: r.kind as ProjectKind,
      status: 'active',
      meta: JSON.parse(r.meta_json || '{}'),
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
  }

  public async createProject(title: string, kind: ProjectKind = 'general', meta: Record<string, unknown> = {}): Promise<Project> {
    const userId = await this.getCurrentUserId();
    const id = 'proj-' + Math.random().toString(36).substring(2, 10) + '-' + Date.now().toString(36);
    const now = new Date().toISOString();
    const metaJson = JSON.stringify(meta);

    this.db.prepare(`
      INSERT INTO projects (id, user_id, title, kind, meta_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, title, kind, metaJson, now, now);

    return { id, user_id: userId, title, kind, status: 'active', meta, created_at: now, updated_at: now };
  }

  public async getProject(id: string): Promise<Project | null> {
    const r = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      user_id: r.user_id,
      title: r.title,
      kind: r.kind as ProjectKind,
      status: 'active',
      meta: JSON.parse(r.meta_json || '{}'),
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  }

  // ── Documents ─────────────────────────────────────────────────────────────

  public async listDocuments(projectId: string): Promise<Document[]> {
    const userId = await this.getCurrentUserId();
    const rows = this.db.prepare('SELECT * FROM documents WHERE project_id = ? ORDER BY sort_order ASC, updated_at DESC').all(projectId) as any[];
    return rows.map((r) => {
      const contentJson = JSON.parse(r.content_json || '{}');
      return {
        id: r.id,
        project_id: r.project_id,
        user_id: userId,
        title: r.title,
        doc_type: 'general',
        content_json: contentJson,
        plain_text: r.title,
        sort_order: r.sort_order,
        status: r.status as DocumentStatus,
        word_count: 0,
        created_at: r.created_at,
        updated_at: r.updated_at,
      };
    });
  }

  public async getDocument(id: string): Promise<Document | null> {
    const userId = await this.getCurrentUserId();
    const r = this.db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as any;
    if (!r) return null;
    const contentJson = JSON.parse(r.content_json || '{}');
    return {
      id: r.id,
      project_id: r.project_id,
      user_id: userId,
      title: r.title,
      doc_type: 'general',
      content_json: contentJson,
      plain_text: r.title,
      sort_order: r.sort_order,
      status: r.status as DocumentStatus,
      word_count: 0,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  }

  public async findBlankDocument(projectId: string): Promise<Document | null> {
    const docs = await this.listDocuments(projectId);
    const blank = docs.find((d) => {
      const contentStr = JSON.stringify(d.content_json || {});
      return contentStr === '{}' || contentStr.includes('"content":[]');
    });
    return blank || null;
  }

  public async createDocument(
    projectId: string,
    title = 'Untitled Document',
    contentJson: Record<string, unknown> = {},
  ): Promise<Document> {
    const userId = await this.getCurrentUserId();
    const id = 'doc-' + Math.random().toString(36).substring(2, 10) + '-' + Date.now().toString(36);
    const now = new Date().toISOString();
    const contentStr = JSON.stringify(contentJson);

    this.db.prepare(`
      INSERT INTO documents (id, project_id, title, content_json, status, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'draft', 0, ?, ?)
    `).run(id, projectId, title, contentStr, now, now);

    return {
      id,
      project_id: projectId,
      user_id: userId,
      title,
      doc_type: 'general',
      content_json: contentJson,
      plain_text: title,
      sort_order: 0,
      status: 'draft',
      word_count: 0,
      created_at: now,
      updated_at: now,
    };
  }

  public async updateDocument(
    id: string,
    updates: Partial<Pick<Document, 'title' | 'content_json' | 'status' | 'sort_order'>>,
  ): Promise<Document> {
    const doc = await this.getDocument(id);
    if (!doc) throw new Error(`Document ${id} not found`);

    const now = new Date().toISOString();
    const title = updates.title ?? doc.title;
    const contentJson = updates.content_json ?? doc.content_json;
    const status = updates.status ?? doc.status;
    const sortOrder = updates.sort_order ?? doc.sort_order;

    this.db.prepare(`
      UPDATE documents 
      SET title = ?, content_json = ?, status = ?, sort_order = ?, updated_at = ?
      WHERE id = ?
    `).run(title, JSON.stringify(contentJson), status, sortOrder, now, id);

    return { ...doc, title, content_json: contentJson, status, sort_order: sortOrder, updated_at: now };
  }

  public async deleteDocument(id: string): Promise<void> {
    this.db.prepare('DELETE FROM documents WHERE id = ?').run(id);
  }

  public async snapshotVersion(
    documentId: string,
    contentJson: Record<string, unknown>,
    label?: string,
  ): Promise<DocumentVersion> {
    const id = 'ver-' + Math.random().toString(36).substring(2, 10);
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO document_versions (id, document_id, content_json, label, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, documentId, JSON.stringify(contentJson), label || null, now);

    return { id, document_id: documentId, content_json: contentJson, plain_text: '', label, created_at: now };
  }

  public async listDocumentVersions(documentId: string): Promise<DocumentVersion[]> {
    const rows = this.db.prepare('SELECT * FROM document_versions WHERE document_id = ? ORDER BY created_at DESC').all(documentId) as any[];
    return rows.map((r) => ({
      id: r.id,
      document_id: r.document_id,
      content_json: JSON.parse(r.content_json || '{}'),
      plain_text: '',
      label: r.label || undefined,
      created_at: r.created_at,
    }));
  }

  // ── Library ───────────────────────────────────────────────────────────────

  public async listItems(projectId?: string): Promise<LibraryItem[]> {
    const userId = await this.getCurrentUserId();
    const sql = projectId
      ? 'SELECT * FROM library_items WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC'
      : 'SELECT * FROM library_items WHERE user_id = ? ORDER BY created_at DESC';
    const rows = (projectId ? this.db.prepare(sql).all(userId, projectId) : this.db.prepare(sql).all(userId)) as any[];

    return rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      project_id: r.project_id || undefined,
      kind: (r.source_type || 'note') as LibraryItemKind,
      title: r.title,
      storage_path: r.file_path || undefined,
      created_at: r.created_at,
      meta: JSON.parse(r.meta_json || '{}'),
    }));
  }

  public async createItem(item: Partial<LibraryItem> & { title: string }): Promise<LibraryItem | null> {
    const userId = await this.getCurrentUserId();
    const id = item.id || 'lib-' + Math.random().toString(36).substring(2, 10);
    const now = new Date().toISOString();
    const kind = item.kind || 'note';

    this.db.prepare(`
      INSERT INTO library_items (id, user_id, project_id, title, source_type, file_path, meta_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, item.project_id || null, item.title, kind, item.storage_path || null, JSON.stringify(item.meta || {}), now, now);

    return {
      id,
      user_id: userId,
      project_id: item.project_id,
      kind,
      title: item.title,
      storage_path: item.storage_path,
      created_at: now,
      meta: item.meta || {},
    };
  }

  public async deleteItem(id: string): Promise<void> {
    this.db.prepare('DELETE FROM library_items WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM library_chunk_vec WHERE chunk_id IN (SELECT id FROM library_chunks WHERE library_item_id = ?)').run(id);
    this.db.prepare('DELETE FROM library_chunks WHERE library_item_id = ?').run(id);
  }

  // ── Annotations ───────────────────────────────────────────────────────────

  public async listAnnotations(documentId: string): Promise<AnnotationItem[]> {
    const rows = this.db.prepare('SELECT * FROM annotations WHERE document_id = ? ORDER BY created_at ASC').all(documentId) as any[];
    return rows.map((r) => ({
      id: r.id,
      document_id: r.document_id,
      user_id: r.user_id,
      anchor: JSON.parse(r.range_json || '{"quote":""}'),
      note: r.note || '',
      color: r.color,
      created_at: r.created_at,
    }));
  }

  public async createAnnotation(item: Omit<AnnotationItem, 'id' | 'created_at'>): Promise<AnnotationItem> {
    const userId = await this.getCurrentUserId();
    const id = 'ann-' + Math.random().toString(36).substring(2, 10);
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO annotations (id, user_id, document_id, selected_text, note, color, range_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, item.document_id, item.anchor?.quote || '', item.note || '', item.color || 'yellow', JSON.stringify(item.anchor || {}), now, now);

    return { id, document_id: item.document_id, user_id: userId, anchor: item.anchor, note: item.note, color: item.color, created_at: now };
  }

  public async updateAnnotation(id: string, updates: Partial<AnnotationItem>): Promise<AnnotationItem> {
    const row = this.db.prepare('SELECT * FROM annotations WHERE id = ?').get(id) as any;
    if (!row) throw new Error(`Annotation ${id} not found`);

    const now = new Date().toISOString();
    const note = updates.note !== undefined ? updates.note : row.note;
    const color = updates.color !== undefined ? updates.color : row.color;

    this.db.prepare('UPDATE annotations SET note = ?, color = ?, updated_at = ? WHERE id = ?').run(note || '', color, now, id);

    return {
      id: row.id,
      document_id: row.document_id,
      user_id: row.user_id,
      anchor: JSON.parse(row.range_json || '{"quote":""}'),
      note,
      color,
      created_at: row.created_at,
    };
  }

  public async deleteAnnotation(id: string): Promise<void> {
    this.db.prepare('DELETE FROM annotations WHERE id = ?').run(id);
  }

  // ── Task Runs ─────────────────────────────────────────────────────────────

  public async listTaskRuns(documentId?: string): Promise<TaskRun[]> {
    const userId = await this.getCurrentUserId();
    const sql = documentId
      ? 'SELECT * FROM task_runs WHERE user_id = ? AND document_id = ? ORDER BY created_at DESC'
      : 'SELECT * FROM task_runs WHERE user_id = ? ORDER BY created_at DESC';
    const rows = (documentId ? this.db.prepare(sql).all(userId, documentId) : this.db.prepare(sql).all(userId)) as any[];

    return rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      document_id: r.document_id || undefined,
      task_slug: r.task_slug,
      status: r.status as TaskRunStatus,
      input: JSON.parse(r.input_json || '{}'),
      output: JSON.parse(r.output_json || '{}'),
      error: r.error || undefined,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
  }

  public async createTaskRun(run: Omit<TaskRun, 'id' | 'created_at' | 'updated_at'>): Promise<TaskRun> {
    const userId = await this.getCurrentUserId();
    const id = 'trun-' + Math.random().toString(36).substring(2, 10);
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO task_runs (id, user_id, document_id, task_slug, source, status, input_json, output_json, error, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'editor', ?, ?, ?, ?, ?, ?)
    `).run(id, userId, run.document_id || null, run.task_slug, run.status || 'pending', JSON.stringify(run.input || {}), JSON.stringify(run.output || {}), run.error || null, now, now);

    return { id, ...run, user_id: userId, created_at: now, updated_at: now };
  }

  public async updateTaskRunStatus(
    id: string,
    status: TaskRunStatus,
    outputJson?: Record<string, unknown>,
    error?: string,
  ): Promise<TaskRun> {
    const row = this.db.prepare('SELECT * FROM task_runs WHERE id = ?').get(id) as any;
    if (!row) throw new Error(`Task run ${id} not found`);

    const now = new Date().toISOString();
    const outStr = outputJson ? JSON.stringify(outputJson) : row.output_json;

    this.db.prepare('UPDATE task_runs SET status = ?, output_json = ?, error = ?, updated_at = ? WHERE id = ?')
      .run(status, outStr, error || null, now, id);

    return {
      id: row.id,
      user_id: row.user_id,
      document_id: row.document_id || undefined,
      task_slug: row.task_slug,
      status,
      input: JSON.parse(row.input_json || '{}'),
      output: JSON.parse(outStr || '{}'),
      error: error || undefined,
      created_at: row.created_at,
      updated_at: now,
    };
  }

  // ── Graph ─────────────────────────────────────────────────────────────────

  public async listEntities(): Promise<Entity[]> {
    const userId = await this.getCurrentUserId();
    const rows = this.db.prepare('SELECT * FROM entities WHERE user_id = ? ORDER BY name ASC').all(userId) as any[];
    return rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      canonical_name: r.canonical_name || r.name,
      kind: r.type as any,
      aliases: [],
      summary: r.description || undefined,
      created_at: r.created_at,
    }));
  }

  public async createEntity(entity: Omit<Entity, 'id' | 'created_at'>): Promise<Entity> {
    const userId = await this.getCurrentUserId();
    const id = 'ent-' + Math.random().toString(36).substring(2, 10);
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO entities (id, user_id, name, type, description, canonical_name, meta_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?)
    `).run(id, userId, entity.canonical_name, entity.kind, entity.summary || null, entity.canonical_name, now, now);

    return { id, ...entity, user_id: userId, created_at: now };
  }
}
