import { ipcMain, BrowserWindow } from 'electron';
import { ALLOWED_IPC_CHANNELS } from './registry.js';
import { estimateImport } from '../shamela/estimate.js';
import { importShamelaBooks, filterAlreadyImported } from '../shamela/import.js';
import { getWorkspaceDbService } from './workspaceHandlers.js';
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

/**
 * One import runs at a time. The flag is what the renderer's cancel button
 * flips: importShamelaBooks checks it between pages and chunks, so cancelling
 * keeps everything already embedded (SPEC-M5.9 FR-2.5).
 */
let importSignal: { aborted: boolean } | null = null;

export function registerShamelaHandlers(): void {
  ipcMain.handle(ALLOWED_IPC_CHANNELS.SHAMELA_CANCEL_IMPORT, async () => {
    if (importSignal) importSignal.aborted = true;
    return { cancelled: true };
  });

  ipcMain.handle(
    ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE,
    async (event, payload: { action: string; [key: string]: unknown }) => {
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

        // ── Import (SPEC-M5.9 FR-2) ───────────────────────────────
        case 'import:estimate': {
          const masterDbPath = String(payload.masterDbPath || '');
          if (!masterDbPath) throw new Error('masterDbPath is required');
          const bookIds = Array.isArray(payload.bookIds) ? (payload.bookIds as number[]) : [];
          // Catalogue read only — deliberately no text read and no network,
          // so the user sees the cost before anything is spent (risk R7).
          return estimateImport(masterDbPath, bookIds);
        }

        case 'import:alreadyImported': {
          const bookIds = Array.isArray(payload.bookIds) ? (payload.bookIds as number[]) : [];
          const service = await getWorkspaceDbService();
          return service.filterAlreadyImported(bookIds);
        }

        case 'import:books': {
          if (importSignal && !importSignal.aborted) {
            throw new Error('ایک درآمد پہلے ہی جاری ہے۔');
          }

          const books = Array.isArray(payload.books)
            ? (payload.books as Array<{ id: number; title: string; author?: string | null }>)
            : [];
          if (books.length === 0) throw new Error('کوئی کتاب منتخب نہیں۔');

          const window = BrowserWindow.fromWebContents(event.sender);
          importSignal = { aborted: false };

          try {
            const service = await getWorkspaceDbService();
            return await service.importShamelaBooks({
              books,
              signal: importSignal,
              onProgress: (progress) => {
                if (window && !window.isDestroyed()) {
                  window.webContents.send(ALLOWED_IPC_CHANNELS.SHAMELA_IMPORT_PROGRESS, progress);
                }
              },
            });
          } finally {
            importSignal = null;
          }
        }

        default:
          throw new Error(`Unknown Shamela IPC action: ${payload.action}`);
      }
    },
  );
}
