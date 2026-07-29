import { ipcMain } from 'electron';
import { ALLOWED_IPC_CHANNELS } from './registry.js';
import { openWorkspaceDatabase, getDbPath } from '../db/open.js';
import { runDatabaseMigrations } from '../db/migrations/runner.js';
import { WorkspaceDbService } from '../db/workspaceDb.js';

let dbService: WorkspaceDbService | null = null;

export function getWorkspaceDbService(): WorkspaceDbService {
  if (!dbService) {
    const dbPath = getDbPath();
    const db = openWorkspaceDatabase(dbPath);
    runDatabaseMigrations(db, dbPath);
    dbService = new WorkspaceDbService(db);
  }
  return dbService;
}

export function registerWorkspaceHandlers(): void {
  ipcMain.handle(
    ALLOWED_IPC_CHANNELS.WORKSPACE_INVOKE,
    async (_event, payload: { method: string; args: unknown[] }) => {
      const service = getWorkspaceDbService() as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
      const fn = service[payload.method];

      if (typeof fn !== 'function') {
        throw new Error(`Unknown local workspace database method: ${payload.method}`);
      }

      return fn.apply(service, payload.args || []);
    },
  );
}
