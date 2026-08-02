/**
 * WorkspaceBackend — the seam that lets one codebase run against two stores.
 *
 * `cloudBackend` talks to Supabase (Postgres + pgvector + storage).
 * `localBackend` (M5.3) talks to the Electron main process over IPC, which
 * owns a SQLite file on the user's machine.
 *
 * The interface is deliberately NOT invented: every signature below is copied
 * verbatim from the service it replaces. Those services were already written
 * as "data operations abstraction layers" returning domain types rather than
 * query builders, which is why the ~40 UI files that consume them need no
 * changes at all.
 *
 * ── What is NOT here, and why ──────────────────────────────────────────────
 *
 * 1. AI calls. `graphService.extractGraphFromText` and
 *    `runLibraryIngest` both go through `supabase.functions.invoke`, i.e.
 *    they are AI operations that happen to live in data-shaped files. They
 *    belong to the AI adapter in M5.2, not here — a store is not a model.
 *
 * 2. `bookSectionMigration`. It migrates the legacy `book_projects` /
 *    `book_chapters` / `book_sections` / `translation_projects` tables into
 *    `projects` and `documents`. Those legacy tables exist only in the hosted
 *    database; a fresh local SQLite file has nothing to migrate. Requiring
 *    localBackend to implement it would mean writing dead code to satisfy an
 *    interface. It stays cloud-only, alongside Admin/Pricing/OCR.
 *
 * SPEC-M5 FR-1.1 / FR-1.2.
 */

import type {
  Project,
  ProjectKind,
  Document,
  DocumentVersion,
  LibraryItem,
  TaskRun,
  TaskRunStatus,
  TaskRunSource,
} from "@/core/workspace/types";
import type { AnnotationItem } from "@/core/workspace/annotationService";
import type { Entity, EntityDetails } from "@/lib/graph/graphService";
import type { Recipe } from "@/lib/recipes/recipeService";
import type { CustomTaskRow } from "@/lib/tasks/customTasks";
import type { ChunkProgress } from "@/lib/tasks/types";

// ── Identity ────────────────────────────────────────────────────────────────

/**
 * Several services call `supabase.auth.getUser()` inline to stamp `user_id` on
 * inserts. Local mode has no auth at all, so identity has to become part of
 * the backend contract rather than an ambient global.
 *
 * cloud → the signed-in Supabase user.
 * local → a stable UUID minted on first run and kept in `corpus_meta`.
 */
export interface IdentityBackend {
  /** Null when nobody is signed in (cloud) — never null in local mode. */
  getCurrentUserId(): Promise<string | null>;
}

// ── Documents & projects ────────────────────────────────────────────────────

export interface DocumentBackend {
  listProjects(): Promise<Project[]>;
  createProject(title: string, kind?: ProjectKind, meta?: Record<string, unknown>): Promise<Project>;
  getProject(id: string): Promise<Project | null>;

  listDocuments(projectId: string): Promise<Document[]>;
  getDocument(id: string): Promise<Document | null>;
  /** Most recently touched empty document, so `/editor` stops leaving blanks. */
  findBlankDocument(projectId: string): Promise<Document | null>;
  createDocument(
    projectId: string,
    title?: string,
    contentJson?: Record<string, unknown>,
  ): Promise<Document>;
  updateDocument(
    id: string,
    updates: Partial<Pick<Document, "title" | "content_json" | "status" | "sort_order">>,
  ): Promise<Document>;
  deleteDocument(id: string): Promise<void>;

  snapshotVersion(
    documentId: string,
    contentJson: Record<string, unknown>,
    label?: string,
  ): Promise<DocumentVersion>;
  listDocumentVersions(documentId: string): Promise<DocumentVersion[]>;
}

// ── Library ─────────────────────────────────────────────────────────────────

export interface LibraryBackend {
  listItems(projectId?: string): Promise<LibraryItem[]>;
  getItem(itemId: string): Promise<LibraryItem | null>;
  createItem(item: Partial<LibraryItem> & { title: string }): Promise<LibraryItem | null>;

  /** Stores the file (cloud: storage bucket · local: `files/` beside the DB). */
  uploadLibraryFile(
    file: File,
    kind?: "book" | "ocr" | "audio" | "custom",
  ): Promise<LibraryItem | null>;
  /** Must remove chunks AND the stored file — no orphans either side. */
  deleteLibraryItem(itemId: string): Promise<boolean>;
  listLibraryItems(): Promise<LibraryItem[]>;

  /** SPEC-M6: Record that a library item was accessed (for recent books). */
  accessItem(itemId: string): Promise<void>;
  /** SPEC-M6: Get recently accessed library items, most recent first. */
  getRecentItems(limit?: number): Promise<RecentItem[]>;
  /** SPEC-M6: Get total count of library items. */
  getLibraryItemCount(): Promise<number>;
  /** SPEC-M6 Phase 5: FTS5 keyword search across imported chunks. */
  searchChunks(query: string, limit?: number): Promise<ChunkSearchHit[]>;
}

export interface ChunkSearchHit {
  itemId: string;
  title: string;
  sourceRef: Record<string, unknown>;
  pageNumber: number | null;
  content: string;
  rank: number;
}

export interface RecentItem {
  itemId: string;
  accessedAt: string;
  title: string;
  kind: string;
  sourceRef: Record<string, unknown>;
  meta: Record<string, unknown>;
  totalPages?: number;
}

// ── Annotations ─────────────────────────────────────────────────────────────

export interface AnnotationBackend {
  createAnnotation(params: {
    documentId: string;
    quote: string;
    note: string;
    color?: string;
  }): Promise<AnnotationItem | null>;
  updateAnnotation(
    id: string,
    params: { note?: string; anchor?: { quote: string; isDetached?: boolean } },
  ): Promise<boolean>;
  deleteAnnotation(id: string): Promise<boolean>;
  listAnnotations(documentId: string): Promise<AnnotationItem[]>;
}

// ── Task runs (the Trust tab's audit trail) ─────────────────────────────────

export interface TaskRunBackend {
  createTaskRun(params: {
    projectId?: string;
    documentId?: string;
    taskSlug: string;
    input?: Record<string, unknown>;
    model?: string;
  }): Promise<TaskRun | null>;
  updateTaskRun(
    runId: string,
    params: {
      status?: TaskRunStatus;
      output?: Record<string, unknown>;
      sources?: TaskRunSource[];
      confidence?: number;
      model?: string;
      tokensSpent?: number;
      error?: string;
      progress?: ChunkProgress;
    },
  ): Promise<boolean>;
  listTaskRuns(documentId: string): Promise<TaskRun[]>;
  /** Powers the "unfinished run" resume card (SPEC-M4 FR-1.2). */
  findIncompleteRun(documentId: string): Promise<TaskRun | null>;
}

// ── Knowledge graph (data operations only — extraction is an AI call) ───────

export interface GraphBackend {
  listEntities(searchQuery?: string): Promise<Entity[]>;
  getEntityDetails(entityId: string): Promise<EntityDetails | null>;
  /** Only ever invoked from an explicit user action; keeps merges reversible. */
  mergeEntities(keepId: string, absorbId: string, mergedAliases: string[]): Promise<boolean>;
}

// ── Recipes & custom tasks ──────────────────────────────────────────────────

export interface RecipeBackend {
  listRecipes(): Promise<Recipe[]>;
}

export interface CustomTaskBackend {
  list(): Promise<CustomTaskRow[]>;
  createFromBuiltin(
    baseSlug: string,
    label: string,
    systemPrompt: string,
  ): Promise<CustomTaskRow | null>;
  update(id: string, patch: { label?: string; system_prompt?: string }): Promise<boolean>;
  /** Archive, never delete — old `task_runs` must keep a resolvable name. */
  archive(id: string): Promise<boolean>;
}

// ── The whole surface ───────────────────────────────────────────────────────

export interface WorkspaceBackend {
  readonly kind: "cloud" | "local";
  identity: IdentityBackend;
  documents: DocumentBackend;
  library: LibraryBackend;
  annotations: AnnotationBackend;
  taskRuns: TaskRunBackend;
  graph: GraphBackend;
  recipes: RecipeBackend;
  customTasks: CustomTaskBackend;
}
