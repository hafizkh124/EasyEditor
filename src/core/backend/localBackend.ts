import type { WorkspaceBackend, RecentItem } from './types';
import type {
  Project,
  ProjectKind,
  Document,
  DocumentVersion,
  LibraryItem,
  TaskRun,
  TaskRunStatus,
  TaskRunSource,
} from '@/core/workspace/types';
import type { AnnotationItem } from '@/core/workspace/annotationService';
import type { Entity, EntityDetails } from '@/lib/graph/graphService';
import type { Recipe } from '@/lib/recipes/recipeService';
import type { CustomTaskRow } from '@/lib/tasks/customTasks';
import type { ChunkProgress } from '@/lib/tasks/types';

async function invokeWorkspace<T>(method: string, ...args: unknown[]): Promise<T> {
  if (typeof window !== 'undefined' && (window as any).electronAPI) {
    return (window as any).electronAPI.invoke('workspace:invoke', { method, args }) as Promise<T>;
  }
  throw new Error(`localBackend can only run in Electron desktop mode (method: ${method})`);
}

export const localBackend: WorkspaceBackend = {
  kind: 'local',

  identity: {
    async getCurrentUserId(): Promise<string | null> {
      return invokeWorkspace<string>('getCurrentUserId');
    },
  },

  documents: {
    async listProjects(): Promise<Project[]> {
      return invokeWorkspace<Project[]>('listProjects');
    },

    async createProject(title: string, kind: ProjectKind = 'general', meta: Record<string, unknown> = {}): Promise<Project> {
      return invokeWorkspace<Project>('createProject', title, kind, meta);
    },

    async getProject(id: string): Promise<Project | null> {
      return invokeWorkspace<Project | null>('getProject', id);
    },

    async listDocuments(projectId: string): Promise<Document[]> {
      return invokeWorkspace<Document[]>('listDocuments', projectId);
    },

    async getDocument(id: string): Promise<Document | null> {
      return invokeWorkspace<Document | null>('getDocument', id);
    },

    async findBlankDocument(projectId: string): Promise<Document | null> {
      return invokeWorkspace<Document | null>('findBlankDocument', projectId);
    },

    async createDocument(
      projectId: string,
      title = 'Untitled Document',
      contentJson: Record<string, unknown> = {},
    ): Promise<Document> {
      return invokeWorkspace<Document>('createDocument', projectId, title, contentJson);
    },

    async updateDocument(
      id: string,
      updates: Partial<Pick<Document, 'title' | 'content_json' | 'status' | 'sort_order'>>,
    ): Promise<Document> {
      return invokeWorkspace<Document>('updateDocument', id, updates);
    },

    async deleteDocument(id: string): Promise<void> {
      return invokeWorkspace<void>('deleteDocument', id);
    },

    async snapshotVersion(
      documentId: string,
      contentJson: Record<string, unknown>,
      label?: string,
    ): Promise<DocumentVersion> {
      return invokeWorkspace<DocumentVersion>('snapshotVersion', documentId, contentJson, label);
    },

    async listDocumentVersions(documentId: string): Promise<DocumentVersion[]> {
      return invokeWorkspace<DocumentVersion[]>('listDocumentVersions', documentId);
    },
  },

  library: {
    async listItems(projectId?: string): Promise<LibraryItem[]> {
      return invokeWorkspace<LibraryItem[]>('listItems', projectId);
    },

    async getItem(itemId: string): Promise<LibraryItem | null> {
      return invokeWorkspace<LibraryItem | null>('getItem', itemId);
    },

    async listLibraryItems(): Promise<LibraryItem[]> {
      return invokeWorkspace<LibraryItem[]>('listItems');
    },

    async createItem(item: Partial<LibraryItem> & { title: string }): Promise<LibraryItem | null> {
      return invokeWorkspace<LibraryItem | null>('createItem', item);
    },

    async uploadLibraryFile(
      file: File,
      kind?: "book" | "ocr" | "audio" | "custom",
    ): Promise<LibraryItem | null> {
      return invokeWorkspace<LibraryItem | null>('createItem', {
        title: file.name,
        kind: kind === 'custom' ? 'note' : (kind || 'note'),
        storage_path: file.name,
      });
    },

    async deleteLibraryItem(itemId: string): Promise<boolean> {
      await invokeWorkspace<void>('deleteItem', itemId);
      return true;
    },

    async accessItem(itemId: string): Promise<void> {
      await invokeWorkspace<void>('accessItem', itemId);
    },

    async getRecentItems(limit = 10): Promise<RecentItem[]> {
      return invokeWorkspace<RecentItem[]>('getRecentItems', limit);
    },

    async getLibraryItemCount(): Promise<number> {
      return invokeWorkspace<number>('getLibraryItemCount');
    },
  },

  annotations: {
    async createAnnotation(params: {
      documentId: string;
      quote: string;
      note: string;
      color?: string;
    }): Promise<AnnotationItem | null> {
      return invokeWorkspace<AnnotationItem>('createAnnotation', {
        document_id: params.documentId,
        anchor: { quote: params.quote },
        note: params.note,
        color: params.color,
      });
    },

    async updateAnnotation(
      id: string,
      params: { note?: string; anchor?: { quote: string; isDetached?: boolean } },
    ): Promise<boolean> {
      await invokeWorkspace<AnnotationItem>('updateAnnotation', id, params);
      return true;
    },

    async deleteAnnotation(id: string): Promise<boolean> {
      await invokeWorkspace<void>('deleteAnnotation', id);
      return true;
    },

    async listAnnotations(documentId: string): Promise<AnnotationItem[]> {
      return invokeWorkspace<AnnotationItem[]>('listAnnotations', documentId);
    },
  },

  taskRuns: {
    async createTaskRun(params: {
      projectId?: string;
      documentId?: string;
      taskSlug: string;
      input?: Record<string, unknown>;
      model?: string;
    }): Promise<TaskRun | null> {
      return invokeWorkspace<TaskRun>('createTaskRun', {
        project_id: params.projectId,
        document_id: params.documentId,
        task_slug: params.taskSlug,
        input: params.input,
        status: 'pending',
      });
    },

    async updateTaskRun(
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
    ): Promise<boolean> {
      await invokeWorkspace<TaskRun>('updateTaskRunStatus', runId, params.status || 'completed', params.output, params.error);
      return true;
    },

    async listTaskRuns(documentId: string): Promise<TaskRun[]> {
      return invokeWorkspace<TaskRun[]>('listTaskRuns', documentId);
    },

    async findIncompleteRun(documentId: string): Promise<TaskRun | null> {
      const runs = await invokeWorkspace<TaskRun[]>('listTaskRuns', documentId);
      return runs.find((r) => r.status === 'pending' || r.status === 'running') || null;
    },
  },

  graph: {
    async listEntities(searchQuery?: string): Promise<Entity[]> {
      const entities = await invokeWorkspace<Entity[]>('listEntities');
      if (!searchQuery) return entities;
      const q = searchQuery.toLowerCase();
      return entities.filter((e) => e.canonical_name.toLowerCase().includes(q));
    },

    async getEntityDetails(entityId: string): Promise<EntityDetails | null> {
      return invokeWorkspace<EntityDetails | null>('getEntityDetails', entityId);
    },

    async mergeEntities(keepId: string, absorbId: string, mergedAliases: string[]): Promise<boolean> {
      return invokeWorkspace<boolean>('mergeEntities', keepId, absorbId, mergedAliases);
    },
  },

  recipes: {
    async listRecipes(): Promise<Recipe[]> {
      return invokeWorkspace<Recipe[]>('listRecipes');
    },
  },

  customTasks: {
    async list(): Promise<CustomTaskRow[]> {
      return invokeWorkspace<CustomTaskRow[]>('listCustomTasks');
    },

    async createFromBuiltin(
      baseSlug: string,
      label: string,
      systemPrompt: string,
    ): Promise<CustomTaskRow | null> {
      return invokeWorkspace<CustomTaskRow>('createCustomTaskFromBuiltin', baseSlug, label, systemPrompt);
    },

    async update(id: string, patch: { label?: string; system_prompt?: string }): Promise<boolean> {
      return invokeWorkspace<boolean>('updateCustomTask', id, patch);
    },

    async archive(id: string): Promise<boolean> {
      return invokeWorkspace<boolean>('archiveCustomTask', id);
    },
  },
};
