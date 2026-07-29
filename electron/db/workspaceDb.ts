import type { SqliteDatabase } from './open.js';
import * as documents from './workspaceStore/documents.js';
import * as library from './workspaceStore/library.js';
import * as annotations from './workspaceStore/annotations.js';
import * as taskRuns from './workspaceStore/taskRuns.js';
import * as graph from './workspaceStore/graph.js';
import * as recipes from './workspaceStore/recipes.js';
import * as customTasks from './workspaceStore/customTasks.js';
import { getCurrentUserId } from './workspaceStore/identity.js';
import type {
  Project, ProjectKind, Document, DocumentVersion, LibraryItem, TaskRun, TaskRunStatus,
} from '../../src/core/workspace/types.js';
import type { AnnotationItem } from '../../src/core/workspace/annotationService.js';
import type { Entity, EntityDetails } from '../../src/lib/graph/graphService.js';
import type { Recipe } from '../../src/lib/recipes/builtinRecipes.js';
import type { CustomTaskRow } from '../../src/lib/tasks/customTasks.js';

/**
 * Public surface for the `workspace:invoke` IPC channel (electron/ipc/workspaceHandlers.ts).
 * Method NAMES here are the allowlist workspaceHandlers.ts dispatches against
 * — every actual query lives in ./workspaceStore/*.ts, split by concern to
 * stay under NFR-1's 300-line ceiling (SPEC-M5 FR-4.2/FR-1.1).
 */
export class WorkspaceDbService {
  constructor(private db: SqliteDatabase) {}

  public async getCurrentUserId(): Promise<string> {
    return getCurrentUserId(this.db);
  }

  // ── Projects & documents ──────────────────────────────────────────────────
  public async listProjects(): Promise<Project[]> { return documents.listProjects(this.db); }
  public async createProject(title: string, kind?: ProjectKind, meta?: Record<string, unknown>): Promise<Project> {
    return documents.createProject(this.db, title, kind, meta);
  }
  public async getProject(id: string): Promise<Project | null> { return documents.getProject(this.db, id); }
  public async listDocuments(projectId: string): Promise<Document[]> { return documents.listDocuments(this.db, projectId); }
  public async getDocument(id: string): Promise<Document | null> { return documents.getDocument(this.db, id); }
  public async findBlankDocument(projectId: string): Promise<Document | null> { return documents.findBlankDocument(this.db, projectId); }
  public async createDocument(projectId: string, title?: string, contentJson?: Record<string, unknown>): Promise<Document> {
    return documents.createDocument(this.db, projectId, title, contentJson);
  }
  public async updateDocument(id: string, updates: Partial<Pick<Document, 'title' | 'content_json' | 'status' | 'sort_order'>>): Promise<Document> {
    return documents.updateDocument(this.db, id, updates);
  }
  public async deleteDocument(id: string): Promise<void> { return documents.deleteDocument(this.db, id); }
  public async snapshotVersion(documentId: string, contentJson: Record<string, unknown>, label?: string): Promise<DocumentVersion> {
    return documents.snapshotVersion(this.db, documentId, contentJson, label);
  }
  public async listDocumentVersions(documentId: string): Promise<DocumentVersion[]> {
    return documents.listDocumentVersions(this.db, documentId);
  }

  // ── Library ───────────────────────────────────────────────────────────────
  public async listItems(projectId?: string): Promise<LibraryItem[]> { return library.listItems(this.db, projectId); }
  public async createItem(item: Partial<LibraryItem> & { title: string }): Promise<LibraryItem> {
    return library.createItem(this.db, item);
  }
  public async deleteItem(id: string): Promise<void> { return library.deleteItem(this.db, id); }

  // ── Annotations ───────────────────────────────────────────────────────────
  public async listAnnotations(documentId: string): Promise<AnnotationItem[]> { return annotations.listAnnotations(this.db, documentId); }
  public async createAnnotation(item: Omit<AnnotationItem, 'id' | 'created_at'>): Promise<AnnotationItem> {
    return annotations.createAnnotation(this.db, item);
  }
  public async updateAnnotation(id: string, updates: Partial<AnnotationItem>): Promise<AnnotationItem> {
    return annotations.updateAnnotation(this.db, id, updates);
  }
  public async deleteAnnotation(id: string): Promise<void> { return annotations.deleteAnnotation(this.db, id); }

  // ── Task runs ─────────────────────────────────────────────────────────────
  public async listTaskRuns(documentId?: string): Promise<TaskRun[]> { return taskRuns.listTaskRuns(this.db, documentId); }
  public async createTaskRun(run: Omit<TaskRun, 'id' | 'created_at' | 'updated_at'>): Promise<TaskRun> {
    return taskRuns.createTaskRun(this.db, run);
  }
  public async updateTaskRunStatus(id: string, status: TaskRunStatus, outputJson?: Record<string, unknown>, error?: string): Promise<TaskRun> {
    return taskRuns.updateTaskRunStatus(this.db, id, status, outputJson, error);
  }

  // ── Graph ─────────────────────────────────────────────────────────────────
  public async listEntities(): Promise<Entity[]> { return graph.listEntities(this.db); }
  public async createEntity(entity: Omit<Entity, 'id' | 'created_at'>): Promise<Entity> {
    return graph.createEntity(this.db, entity);
  }
  public async getEntityDetails(entityId: string): Promise<EntityDetails | null> {
    return graph.getEntityDetails(this.db, entityId);
  }
  public async mergeEntities(keepId: string, absorbId: string, mergedAliases: string[]): Promise<boolean> {
    return graph.mergeEntities(this.db, keepId, absorbId, mergedAliases);
  }

  // ── Recipes ───────────────────────────────────────────────────────────────
  public async listRecipes(): Promise<Recipe[]> { return recipes.listRecipes(this.db); }

  // ── Custom tasks ──────────────────────────────────────────────────────────
  public async listCustomTasks(): Promise<CustomTaskRow[]> { return customTasks.list(this.db); }
  public async createCustomTaskFromBuiltin(baseSlug: string, label: string, systemPrompt: string): Promise<CustomTaskRow> {
    return customTasks.createFromBuiltin(this.db, baseSlug, label, systemPrompt);
  }
  public async updateCustomTask(id: string, patch: { label?: string; system_prompt?: string }): Promise<boolean> {
    return customTasks.update(this.db, id, patch);
  }
  public async archiveCustomTask(id: string): Promise<boolean> {
    return customTasks.archive(this.db, id);
  }
}
