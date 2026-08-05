/**
 * SPEC-M6 Phase 10 — Shamela PDF access from the renderer.
 *
 * Wraps the native bridge so PDF data flows through the same allowlisted IPC
 * as the rest of the Shamela integration. `masterDbPath` is resolved once via
 * detect() and cached per process, so the reader toolbar and catalogue covers
 * never re-run discovery.
 */

export interface ShamelaPdfFileInfo {
  fileIndex: number;
  name: string;
  path: string;
  size: number;
}

export interface BookPdfInfo {
  available: boolean;
  files: ShamelaPdfFileInfo[];
  coverPage: number | null;
}

let cachedMasterDbPath: string | null | undefined;

export function getShamelaMasterDbPath(): Promise<string | null> {
  if (cachedMasterDbPath !== undefined) return Promise.resolve(cachedMasterDbPath);
  const api = typeof window !== "undefined" ? window.electronAPI?.shamela : undefined;
  if (!api) {
    cachedMasterDbPath = null;
    return Promise.resolve(null);
  }
  return api
    .detect()
    .then((state) => {
      cachedMasterDbPath = state.installed && state.masterDbPath ? state.masterDbPath : null;
      return cachedMasterDbPath;
    })
    .catch(() => {
      cachedMasterDbPath = null;
      return cachedMasterDbPath;
    });
}

export async function getBookPdfInfo(bookId: string | number): Promise<BookPdfInfo> {
  const masterDbPath = await getShamelaMasterDbPath();
  const api = window.electronAPI?.shamela;
  if (!masterDbPath || !api) {
    return { available: false, files: [], coverPage: null };
  }
  return api.bookPdfInfo(masterDbPath, Number(bookId));
}

/** Read one PDF's bytes so pdfjs can render it entirely in memory. */
export async function readBookPdf(bookId: string | number, fileIndex: number): Promise<Uint8Array | null> {
  const masterDbPath = await getShamelaMasterDbPath();
  const api = window.electronAPI?.shamela;
  if (!masterDbPath || !api) return null;
  const info = await api.bookPdfInfo(masterDbPath, Number(bookId));
  const file = info.files.find((f) => f.fileIndex === fileIndex);
  if (!file) return null;
  return api.readBookPdf(masterDbPath, file.path);
}
