import { ipcMain } from 'electron';
import { ALLOWED_IPC_CHANNELS } from './registry.js';
import { openWorkspaceDatabase, getDbPath } from '../db/open.js';
import { runDatabaseMigrations } from '../db/migrations/runner.js';
import { WorkspaceDbService } from '../db/workspaceDb.js';

let dbService: WorkspaceDbService | null = null;

/**
 * SPEC-M5 FR-2.2: an explicit method allowlist, not a reflective pass-through.
 * `service[name]` alone would reach `Object.prototype` members too
 * (`constructor`, `toString`, `__proto__`, …) for any renderer script that
 * managed to send an arbitrary string over this channel. Keep this list in
 * sync with WorkspaceDbService's public methods.
 */
// Exported so a test can check the allowlist against WorkspaceDbService's
// real prototype — the "keep this list in sync" comment above is otherwise an
// unenforced promise.
export const ALLOWED_WORKSPACE_METHODS = new Set<string>([
  'getCurrentUserId',
  'listProjects', 'createProject', 'getProject',
  'listDocuments', 'getDocument', 'findBlankDocument',
  'createDocument', 'updateDocument', 'deleteDocument',
  'snapshotVersion', 'listDocumentVersions',
  'listItems', 'getItem', 'createItem', 'deleteItem',
  'accessItem', 'getRecentItems', 'getLibraryItemCount',
  'addSearch', 'listSearches', 'removeSearch', 'clearSearches',
  'upsertResearchSession', 'loadResearchSession', 'loadLatestResearchSession',
  'listResearchSessions', 'deleteResearchSession',
  'createBatchRun', 'updateBatchRun', 'loadBatchRun', 'latestUnfinishedBatchRun', 'deleteBatchRun',
  'searchChunks', 'searchChunksByRoot',
  'saveReadingProgress', 'getReadingProgress', 'listReadingProgress',
  'addBookmark', 'removeBookmark', 'isBookmarked', 'listBookmarks',
  'addFavorite', 'removeFavorite', 'isFavorite', 'listFavorites',
  'listAnnotations', 'createAnnotation', 'updateAnnotation', 'deleteAnnotation',
  'listTaskRuns', 'createTaskRun', 'updateTaskRunStatus',
  'listEntities', 'createEntity', 'getEntityDetails', 'mergeEntities',
  'listRecipes',
  'listCustomTasks', 'createCustomTaskFromBuiltin', 'updateCustomTask', 'archiveCustomTask',
]);

export async function getWorkspaceDbService(): Promise<WorkspaceDbService> {
  if (!dbService) {
    const dbPath = getDbPath();
    const db = openWorkspaceDatabase(dbPath);
    // Awaited: a migration failure (including a failed pre-migration backup,
    // SPEC-M5 risk R14) must stop initialization here rather than let the
    // service hand out a half-migrated database.
    await runDatabaseMigrations(db, dbPath);
    dbService = new WorkspaceDbService(db);
  }
  return dbService;
}

export function registerWorkspaceHandlers(): void {
  ipcMain.handle(
    ALLOWED_IPC_CHANNELS.WORKSPACE_INVOKE,
    async (_event, payload: { method: string; args: unknown[] }) => {
      if (!ALLOWED_WORKSPACE_METHODS.has(payload.method)) {
        throw new Error(`Workspace IPC method not allowed: ${payload.method}`);
      }

      const service = (await getWorkspaceDbService()) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
      // Read from the class prototype directly rather than `service[name]`,
      // so a method name that only happens to collide with an
      // Object.prototype member (e.g. "toString") can never resolve there.
      const fn = Object.getPrototypeOf(service)[payload.method];

      if (typeof fn !== 'function') {
        throw new Error(`Unknown local workspace database method: ${payload.method}`);
      }

      return fn.apply(service, payload.args || []);
    },
  );
}
