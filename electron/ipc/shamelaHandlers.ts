import { ipcMain } from 'electron';
import { ALLOWED_IPC_CHANNELS } from './registry.js';
import {
  detectShamelaInstallation,
  diagnoseShamelaInstallation,
  saveShamelaPath,
  searchShamelaNative,
  readShamelaPage,
} from '../shamela/shamelaNative.js';
import {
  getCatalogueStats,
  searchBooks,
  listCategories,
  listBooksByCategory,
  closeCatalogueDb,
} from '../shamela/catalogue.js';

export function registerShamelaHandlers(): void {
  ipcMain.handle(
    ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE,
    async (_event, payload: { action: string; [key: string]: unknown }) => {
      switch (payload.action) {
        case 'detect':
          return detectShamelaInstallation();

        case 'diagnose':
          return diagnoseShamelaInstallation();

        case 'savePath':
          if (typeof payload.path === 'string') {
            saveShamelaPath(payload.path);
          }
          return detectShamelaInstallation();

        case 'search':
          return searchShamelaNative(
            String(payload.query || ''),
            typeof payload.limit === 'number' ? payload.limit : 20,
          );

        case 'readPage':
          return readShamelaPage(
            String(payload.bookId || ''),
            typeof payload.pageNumber === 'number' ? payload.pageNumber : 1,
          );

        // ── Catalogue (master.db) ─────────────────────────────────
        case 'catalogue:stats': {
          const masterDbPath = String(payload.masterDbPath || '');
          if (!masterDbPath) throw new Error('masterDbPath is required');
          return getCatalogueStats(masterDbPath);
        }

        case 'catalogue:searchBooks': {
          const masterDbPath = String(payload.masterDbPath || '');
          const query = String(payload.query || '');
          const limit = typeof payload.limit === 'number' ? payload.limit : 50;
          const offset = typeof payload.offset === 'number' ? payload.offset : 0;
          if (!masterDbPath) throw new Error('masterDbPath is required');
          return searchBooks(masterDbPath, query, limit, offset);
        }

        case 'catalogue:listCategories': {
          const masterDbPath = String(payload.masterDbPath || '');
          if (!masterDbPath) throw new Error('masterDbPath is required');
          return listCategories(masterDbPath);
        }

        case 'catalogue:booksByCategory': {
          const masterDbPath = String(payload.masterDbPath || '');
          const categoryId = typeof payload.categoryId === 'number' ? payload.categoryId : 0;
          const limit = typeof payload.limit === 'number' ? payload.limit : 50;
          const offset = typeof payload.offset === 'number' ? payload.offset : 0;
          if (!masterDbPath) throw new Error('masterDbPath is required');
          return listBooksByCategory(masterDbPath, categoryId, limit, offset);
        }

        case 'catalogue:close':
          closeCatalogueDb();
          return { closed: true };

        default:
          throw new Error(`Unknown Shamela IPC action: ${payload.action}`);
      }
    },
  );
}
