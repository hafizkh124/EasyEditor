import type { SqliteDatabase } from './open.js';
import * as documents from './workspaceStore/documents.js';
import * as library from './workspaceStore/library.js';
import * as annotations from './workspaceStore/annotations.js';
import * as taskRuns from './workspaceStore/taskRuns.js';
import * as graph from './workspaceStore/graph.js';
import * as recipes from './workspaceStore/recipes.js';
import * as customTasks from './workspaceStore/customTasks.js';
import { getCurrentUserId } from './workspaceStore/identity.js';
import * as accessLog from './workspaceStore/accessLog.js';
import * as searchHistory from './workspaceStore/searchHistory.js';
import * as sessions from './workspaceStore/sessions.js';
import * as batchRuns from './workspaceStore/batchRuns.js';
import { searchChunks, searchChunksByRoot, type ChunkSearchHit } from './workspaceStore/search.js';
import { searchVectorChunks } from './vectorSearch.js';
import * as readerState from './workspaceStore/readerState.js';
import { ingestLibraryItem, type IngestBatchArgs, type IngestBatchResult } from './ingest.js';
import {
  importShamelaBooks, filterAlreadyImported,
  type ImportBooksArgs, type ImportBooksResult,
} from '../shamela/import.js';
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
  public async updateProject(id: string, updates: Partial<Pick<Project, 'title' | 'meta'>>): Promise<Project> {
    return documents.updateProject(this.db, id, updates);
  }
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
  public async getItem(id: string): Promise<LibraryItem | null> { return library.getItem(this.db, id); }
  public async createItem(item: Partial<LibraryItem> & { title: string }, bytes?: Uint8Array | ArrayBuffer): Promise<LibraryItem> {
    return library.createItem(this.db, item, bytes);
  }
  public async deleteItem(id: string): Promise<void> { return library.deleteItem(this.db, id); }
  public async listChunks(itemId: string, limit = 50, offset = 0): Promise<library.LibraryChunkRow[]> {
    return library.listChunks(this.db, itemId, limit, offset);
  }

  // ── Access Log (SPEC-M6 Home Screen) ──────────────────────────────────────
  public async accessItem(itemId: string): Promise<void> {
    accessLog.accessItem(this.db, itemId);
  }
  public async getRecentItems(limit = 10): Promise<accessLog.RecentItem[]> {
    return accessLog.getRecentItems(this.db, limit);
  }
  public async getLibraryItemCount(): Promise<number> {
    return accessLog.getLibraryItemCount(this.db);
  }
  /** SPEC-M6 Phase 5: FTS5 keyword search over imported chunks. */
  public async searchChunks(query: string, limit = 50, opts?: { libraryItemIds?: string[] }): Promise<ChunkSearchHit[]> {
    return searchChunks(this.db, query, limit, opts);
  }

  /**
   * M13 (ADR-0059) — meaning-based search over the imported corpus, using the
   * sqlite-vec index every ingest already writes (it had no caller before).
   * The caller supplies the query embedding (this layer never calls a model).
   * Hits below `minSimilarity` (cosine) are dropped so a small corpus does not
   * return its nearest-but-unrelated chunks.
   */
  public async searchChunksSemantic(
    queryEmbedding: number[],
    limit = 10,
    opts?: { libraryItemIds?: string[]; minSimilarity?: number },
  ): Promise<ChunkSearchHit[]> {
    const ids = (opts?.libraryItemIds ?? []).filter(Boolean);
    const minSim = opts?.minSimilarity ?? 0.5;
    const raw = searchVectorChunks(this.db, queryEmbedding, ids.length ? Math.min(limit * 5, 100) : limit)
      .filter((r) => 1 - r.distance >= minSim)
      .filter((r) => !ids.length || ids.includes(r.libraryItemId))
      .slice(0, limit);
    if (!raw.length) return [];
    const itemIds = [...new Set(raw.map((r) => r.libraryItemId))];
    const items = this.db
      .prepare(`SELECT id, title, source_ref FROM library_items WHERE id IN (${itemIds.map(() => '?').join(',')})`)
      .all(...itemIds) as Array<{ id: string; title: string; source_ref: string | null }>;
    const byId = new Map(items.map((i) => [i.id, i]));
    return raw
      .filter((r) => byId.has(r.libraryItemId))
      .map((r, i) => {
        const it = byId.get(r.libraryItemId)!;
        let sourceRef: Record<string, unknown> = {};
        try { sourceRef = JSON.parse(it.source_ref || '{}'); } catch { /* keep {} */ }
        return { itemId: r.libraryItemId, title: it.title, sourceRef, pageNumber: r.pageNumber, content: r.content, rank: i };
      });
  }

  /**
   * M13 (ADR-0059) — the library item a folder-ingested file became, by its
   * absolute path, with the size/mtime it was ingested at and whether its
   * embedding finished (folderIngest.ts skips unchanged, finished files).
   */
  public async findLocalDocumentItem(localPath: string): Promise<{ id: string; size?: number; mtimeMs?: number; done: boolean } | null> {
    const userId = getCurrentUserId(this.db);
    const row = this.db
      .prepare(`SELECT id, source_ref, meta FROM library_items
                 WHERE user_id = ? AND json_extract(source_ref, '$.localPath') = ?
                 ORDER BY created_at DESC LIMIT 1`)
      .get(userId, localPath) as { id: string; source_ref: string | null; meta: string | null } | undefined;
    if (!row) return null;
    let ref: { size?: number; mtimeMs?: number } = {};
    let meta: { ingest?: { status?: string } } = {};
    try { ref = JSON.parse(row.source_ref || '{}'); } catch { /* keep {} */ }
    try { meta = JSON.parse(row.meta || '{}'); } catch { /* keep {} */ }
    return { id: row.id, size: ref.size, mtimeMs: ref.mtimeMs, done: meta.ingest?.status === 'ready' || meta.ingest?.status === 'done' };
  }

  /** SPEC-M6 Phase 6: root-expanded keyword search over imported chunks. */
  public async searchChunksByRoot(
    s2DbPath: string | null,
    query: string,
    limit = 50,
  ): Promise<ChunkSearchHit[]> {
    return searchChunksByRoot(this.db, s2DbPath, query, limit);
  }

  // ── Reader state (SPEC-M6 Phase 8) ────────────────────────────────────────
  public async saveReadingProgress(bookId: string, pageNumber: number, pageCount: number): Promise<void> {
    return readerState.saveReadingProgress(this.db, bookId, pageNumber, pageCount);
  }
  public async getReadingProgress(bookId: string): Promise<readerState.ReadingProgress | null> {
    return readerState.getReadingProgress(this.db, bookId);
  }
  public async listReadingProgress(limit = 20): Promise<readerState.ReadingProgress[]> {
    return readerState.listReadingProgress(this.db, limit);
  }
  public async addBookmark(bookId: string, pageNumber: number, note?: string): Promise<readerState.ReaderBookmark> {
    return readerState.addBookmark(this.db, bookId, pageNumber, note);
  }
  public async removeBookmark(bookId: string, pageNumber: number): Promise<boolean> {
    return readerState.removeBookmark(this.db, bookId, pageNumber);
  }
  public async isBookmarked(bookId: string, pageNumber: number): Promise<boolean> {
    return readerState.isBookmarked(this.db, bookId, pageNumber);
  }
  public async listBookmarks(bookId: string): Promise<readerState.ReaderBookmark[]> {
    return readerState.listBookmarks(this.db, bookId);
  }
  public async addFavorite(bookId: string, title: string, author?: string): Promise<readerState.ReaderFavorite> {
    return readerState.addFavorite(this.db, bookId, title, author);
  }
  public async removeFavorite(bookId: string): Promise<boolean> {
    return readerState.removeFavorite(this.db, bookId);
  }
  public async isFavorite(bookId: string): Promise<boolean> {
    return readerState.isFavorite(this.db, bookId);
  }
  public async listFavorites(): Promise<readerState.ReaderFavorite[]> {
    return readerState.listFavorites(this.db);
  }

  /**
   * Deliberately NOT in workspaceHandlers' method allowlist: ingest is reached
   * through the AI channel as `library-ingest`, the same name the web build
   * calls, so one orchestrator drives both runtimes (SPEC-M5.9 FR-1.1).
   */
  public async ingestLibraryItem(args: IngestBatchArgs): Promise<IngestBatchResult> {
    return ingestLibraryItem(this.db, args);
  }

  /**
   * Shamela import (SPEC-M5.9 FR-2.4). Reached through the shamela channel
   * rather than the workspace one, so it is not in workspaceHandlers'
   * method allowlist either.
   */
  public async importShamelaBooks(
    args: Omit<ImportBooksArgs, 'db'>,
  ): Promise<ImportBooksResult> {
    return importShamelaBooks({ ...args, db: this.db });
  }

  public async filterAlreadyImported(bookIds: number[]): Promise<number[]> {
    return filterAlreadyImported(this.db, bookIds);
  }

  // ── Annotations ───────────────────────────────────────────────────────────
  public async listAnnotations(documentId: string): Promise<AnnotationItem[]> { return annotations.listAnnotations(this.db, documentId); }
  public async createAnnotation(item: Omit<AnnotationItem, 'id' | 'created_at'>): Promise<AnnotationItem> {
    return annotations.createAnnotation(this.db, item);
  }
  public async updateAnnotation(id: string, updates: Partial<AnnotationItem>): Promise<AnnotationItem> {
    return annotations.updateAnnotation(this.db, id, updates);
  }
  public async deleteAnnotation(id: string): Promise<void> { return annotations.deleteAnnotation(this.db, id); }

  // ── Search history (plan §3.4) ────────────────────────────────────────────
  public async addSearch(entry: { kind: string; query: string; filters?: Record<string, unknown>; resultCount?: number | null }): Promise<void> {
    searchHistory.addSearch(this.db, entry);
  }
  public async listSearches(limit?: number): Promise<searchHistory.SearchHistoryRow[]> { return searchHistory.listSearches(this.db, limit); }
  public async removeSearch(id: string): Promise<void> { searchHistory.removeSearch(this.db, id); }
  public async clearSearches(): Promise<void> { searchHistory.clearSearches(this.db); }

  // ── Research sessions — offline mirror (plan §3.5) ────────────────────────
  public async upsertResearchSession(p: { id: string | null; title: string; mode: string; messages: unknown[]; citations: unknown[]; selectedDomains: string[] }): Promise<string> {
    return sessions.upsertResearchSession(this.db, p);
  }
  public async loadResearchSession(id: string): Promise<sessions.LocalResearchSession | null> { return sessions.loadResearchSession(this.db, id); }
  public async loadLatestResearchSession(mode: string): Promise<sessions.LocalResearchSession | null> { return sessions.loadLatestResearchSession(this.db, mode); }
  public async listResearchSessions(limit?: number): Promise<sessions.LocalResearchSummary[]> { return sessions.listResearchSessions(this.db, limit); }
  public async deleteResearchSession(id: string): Promise<void> { sessions.deleteResearchSession(this.db, id); }

  // ── Batch agent runs — offline, resumable (plan §4.6) ─────────────────────
  public async createBatchRun(p: { id: string; instruction: string; scopeJson: string; granularity: string; aggregate: string; itemsTotal: number }): Promise<void> {
    batchRuns.createBatchRun(this.db, p);
  }
  public async updateBatchRun(id: string, updates: { itemsDone?: unknown[]; status?: string }): Promise<void> {
    batchRuns.updateBatchRun(this.db, id, updates);
  }
  public async loadBatchRun(id: string): Promise<batchRuns.BatchRunRow | null> { return batchRuns.loadBatchRun(this.db, id); }
  public async latestUnfinishedBatchRun(): Promise<batchRuns.BatchRunRow | null> { return batchRuns.latestUnfinishedBatchRun(this.db); }
  public async deleteBatchRun(id: string): Promise<void> { batchRuns.deleteBatchRun(this.db, id); }

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
