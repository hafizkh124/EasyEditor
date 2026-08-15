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
  readShamelaTocJoined,
  getShamelaPageCount,
  readShamelaBook,
} from '../shamela/shamelaNative.js';
import {
  getCatalogueStats,
  searchBooks,
  listCategories,
  listBooksByCategory,
  listAuthors,
  searchAuthors,
  listBooksByAuthor,
  listPeriods,
  listBooksByPeriod,
  getBookPdfInfo,
  readBookPdfFile,
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

        case 'readToc':
          return readShamelaTocJoined(String(payload.bookId || ''));

        case 'pageCount':
          return getShamelaPageCount(String(payload.bookId || ''));

        // One JVM spawn for the whole book (SPEC-M5.9 risk N4) — used by the
        // web-parity "Import to Workspace" feature, same as the AI-corpus
        // importer already does. Pages come back sorted by numeric page id,
        // since Lucene's TermRangeQuery order isn't guaranteed to be reading
        // order even though it happens to look that way in practice.
        case 'readBook': {
          const bookId = String(payload.bookId || '');
          const pages: Array<{ page: string; text: string; footnotes?: string }> = [];
          const { pageCount } = await readShamelaBook(bookId, (page) => {
            pages.push(page);
            return true;
          });
          pages.sort((a, b) => Number.parseInt(a.page, 10) - Number.parseInt(b.page, 10));
          return { bookId, pageCount, pages };
        }

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

        case 'catalogue:authors': {
          const masterDbPath = String(payload.masterDbPath || '');
          const limit = typeof payload.limit === 'number' ? payload.limit : 50;
          const offset = typeof payload.offset === 'number' ? payload.offset : 0;
          if (!masterDbPath) throw new Error('masterDbPath is required');
          return listAuthors(masterDbPath, limit, offset);
        }

        case 'catalogue:searchAuthors': {
          const masterDbPath = String(payload.masterDbPath || '');
          const query = String(payload.query || '');
          const limit = typeof payload.limit === 'number' ? payload.limit : 50;
          const offset = typeof payload.offset === 'number' ? payload.offset : 0;
          if (!masterDbPath) throw new Error('masterDbPath is required');
          return searchAuthors(masterDbPath, query, limit, offset);
        }

        case 'catalogue:booksByAuthor': {
          const masterDbPath = String(payload.masterDbPath || '');
          const authorId = typeof payload.authorId === 'number' ? payload.authorId : 0;
          const limit = typeof payload.limit === 'number' ? payload.limit : 50;
          const offset = typeof payload.offset === 'number' ? payload.offset : 0;
          if (!masterDbPath) throw new Error('masterDbPath is required');
          return listBooksByAuthor(masterDbPath, authorId, limit, offset);
        }

        case 'catalogue:periods': {
          const masterDbPath = String(payload.masterDbPath || '');
          if (!masterDbPath) throw new Error('masterDbPath is required');
          return listPeriods(masterDbPath);
        }

        case 'catalogue:booksByPeriod': {
          const masterDbPath = String(payload.masterDbPath || '');
          const century = typeof payload.century === 'number' ? payload.century : 0;
          const limit = typeof payload.limit === 'number' ? payload.limit : 50;
          const offset = typeof payload.offset === 'number' ? payload.offset : 0;
          if (!masterDbPath) throw new Error('masterDbPath is required');
          return listBooksByPeriod(masterDbPath, century, limit, offset);
        }

        // ── PDF / covers (SPEC-M6 Phase 10) ───────────────────────
        case 'pdf:info': {
          const masterDbPath = String(payload.masterDbPath || '');
          const bookId = typeof payload.bookId === 'number' ? payload.bookId : Number(payload.bookId);
          if (!masterDbPath) throw new Error('masterDbPath is required');
          if (!Number.isFinite(bookId)) throw new Error('bookId is required');
          return getBookPdfInfo(masterDbPath, bookId);
        }

        case 'pdf:read': {
          const masterDbPath = String(payload.masterDbPath || '');
          const filePath = String(payload.filePath || '');
          if (!masterDbPath || !filePath) throw new Error('masterDbPath and filePath are required');
          const buffer = readBookPdfFile(masterDbPath, filePath);
          if (!buffer) throw new Error('PDF file not found or not allowed');
          // Buffer → Uint8Array so it survives structured-clone over IPC.
          return new Uint8Array(buffer);
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
