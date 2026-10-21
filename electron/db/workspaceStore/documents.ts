import type { SqliteDatabase } from '../open.js';
import { getCurrentUserId, genId } from './identity.js';
import { extractPlainTextFromJSON, countWords } from '../../../shared/text/plainText.js';
import type {
  Project,
  ProjectKind,
  Document,
  DocumentStatus,
  DocumentVersion,
} from '../../../src/core/workspace/types.js';

/** SPEC-M5 FR-4.2: column names copied verbatim from workspace_core.sql. */

export function listProjects(db: SqliteDatabase): Project[] {
  const userId = getCurrentUserId(db);
  const rows = db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as any[];
  return rows.map(mapProjectRow);
}

export function createProject(db: SqliteDatabase, title: string, kind: ProjectKind = 'general', meta: Record<string, unknown> = {}): Project {
  const userId = getCurrentUserId(db);
  const id = genId('proj');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO projects (id, user_id, title, kind, status, meta, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
  `).run(id, userId, title, kind, JSON.stringify(meta), now, now);

  return { id, user_id: userId, title, kind, status: 'active', meta, created_at: now, updated_at: now };
}

export function getProject(db: SqliteDatabase, id: string): Project | null {
  const r = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
  return r ? mapProjectRow(r) : null;
}

export function updateProject(
  db: SqliteDatabase,
  id: string,
  updates: Partial<Pick<Project, 'title' | 'meta'>>,
): Project {
  const project = getProject(db, id);
  if (!project) throw new Error(`Project ${id} not found`);
  const now = new Date().toISOString();
  const title = updates.title ?? project.title;
  const meta = updates.meta ?? project.meta ?? {};
  db.prepare('UPDATE projects SET title = ?, meta = ?, updated_at = ? WHERE id = ?').run(title, JSON.stringify(meta), now, id);
  return { ...project, title, meta, updated_at: now };
}

function mapProjectRow(r: any): Project {
  return {
    id: r.id,
    user_id: r.user_id,
    title: r.title,
    kind: r.kind as ProjectKind,
    status: r.status,
    genre: r.genre || undefined,
    meta: JSON.parse(r.meta || '{}'),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function mapDocumentRow(r: any): Document {
  return {
    id: r.id,
    project_id: r.project_id,
    user_id: r.user_id,
    title: r.title,
    doc_type: r.doc_type,
    content_json: JSON.parse(r.content_json || '{}'),
    plain_text: r.plain_text,
    sort_order: r.sort_order,
    status: r.status as DocumentStatus,
    word_count: r.word_count,
    // Older local databases predate the column, so `r.text_direction` is
    // `undefined` there rather than NULL — normalise both to null, which the
    // editor reads as "undecided, detect from content".
    text_direction: (r.text_direction as Document['text_direction']) ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export function listDocuments(db: SqliteDatabase, projectId: string): Document[] {
  const rows = db.prepare('SELECT * FROM documents WHERE project_id = ? ORDER BY sort_order ASC, updated_at DESC').all(projectId) as any[];
  return rows.map(mapDocumentRow);
}

export function getDocument(db: SqliteDatabase, id: string): Document | null {
  const r = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as any;
  return r ? mapDocumentRow(r) : null;
}

/** Mirrors cloudDocuments.findBlankDocument: most recent zero-word-count document. */
export function findBlankDocument(db: SqliteDatabase, projectId: string): Document | null {
  const r = db.prepare(`
    SELECT * FROM documents WHERE project_id = ? AND word_count = 0
    ORDER BY updated_at DESC LIMIT 1
  `).get(projectId) as any;
  return r ? mapDocumentRow(r) : null;
}

export function createDocument(
  db: SqliteDatabase,
  projectId: string,
  title = 'Untitled Document',
  contentJson: Record<string, unknown> = {},
): Document {
  const userId = getCurrentUserId(db);
  const id = genId('doc');
  const now = new Date().toISOString();
  const plainText = extractPlainTextFromJSON(contentJson);
  const wordCount = countWords(plainText);

  db.prepare(`
    INSERT INTO documents (id, project_id, user_id, title, doc_type, content_json, plain_text, status, sort_order, word_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'prose', ?, ?, 'draft', 0, ?, ?, ?)
  `).run(id, projectId, userId, title, JSON.stringify(contentJson), plainText, wordCount, now, now);

  return {
    id, project_id: projectId, user_id: userId, title, doc_type: 'prose',
    content_json: contentJson, plain_text: plainText, sort_order: 0, status: 'draft',
    word_count: wordCount, text_direction: null, created_at: now, updated_at: now,
  };
}

export function updateDocument(
  db: SqliteDatabase,
  id: string,
  updates: Partial<Pick<Document, 'title' | 'content_json' | 'status' | 'sort_order' | 'text_direction'>>,
): Document {
  const doc = getDocument(db, id);
  if (!doc) throw new Error(`Document ${id} not found`);

  const now = new Date().toISOString();
  const title = updates.title ?? doc.title;
  const contentJson = updates.content_json ?? doc.content_json;
  const status = updates.status ?? doc.status;
  const sortOrder = updates.sort_order ?? doc.sort_order;
  // An explicit `undefined` check, not `??`: null is a legitimate value here
  // ("undecided"), so only an absent key means "leave as-is".
  const textDirection = updates.text_direction !== undefined ? updates.text_direction : (doc.text_direction ?? null);
  const plainText = updates.content_json ? extractPlainTextFromJSON(contentJson) : doc.plain_text;
  const wordCount = updates.content_json ? countWords(plainText) : doc.word_count;

  db.prepare(`
    UPDATE documents
    SET title = ?, content_json = ?, plain_text = ?, status = ?, sort_order = ?, word_count = ?, text_direction = ?, updated_at = ?
    WHERE id = ?
  `).run(title, JSON.stringify(contentJson), plainText, status, sortOrder, wordCount, textDirection, now, id);

  return { ...doc, title, content_json: contentJson, plain_text: plainText, status, sort_order: sortOrder, word_count: wordCount, text_direction: textDirection, updated_at: now };
}

export function deleteDocument(db: SqliteDatabase, id: string): void {
  db.prepare('DELETE FROM documents WHERE id = ?').run(id);
}

export function snapshotVersion(
  db: SqliteDatabase,
  documentId: string,
  contentJson: Record<string, unknown>,
  label?: string,
): DocumentVersion {
  const id = genId('ver');
  const now = new Date().toISOString();
  const plainText = extractPlainTextFromJSON(contentJson);

  db.prepare(`
    INSERT INTO document_versions (id, document_id, content_json, plain_text, label, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, documentId, JSON.stringify(contentJson), plainText, label || null, now);

  return { id, document_id: documentId, content_json: contentJson, plain_text: plainText, label, created_at: now };
}

export function listDocumentVersions(db: SqliteDatabase, documentId: string): DocumentVersion[] {
  const rows = db.prepare('SELECT * FROM document_versions WHERE document_id = ? ORDER BY created_at DESC').all(documentId) as any[];
  return rows.map((r) => ({
    id: r.id,
    document_id: r.document_id,
    content_json: JSON.parse(r.content_json || '{}'),
    plain_text: r.plain_text,
    label: r.label || undefined,
    created_at: r.created_at,
  }));
}
