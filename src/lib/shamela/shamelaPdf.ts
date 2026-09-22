/**
 * SPEC-M6 Phase 10 — Shamela PDF access from the renderer.
 *
 * Wraps the native bridge so PDF data flows through the same allowlisted IPC
 * as the rest of the Shamela integration. `masterDbPath` is resolved once via
 * detect() and cached per process, so the reader toolbar and catalogue covers
 * never re-run discovery.
 *
 * Web transport (Book Translation source C): `tools/shamela-bridge`'s
 * `/reader/pdfInfo` and `/reader/pdf` (reader.mjs's "Scanned-page-image PDFs"
 * section) port the exact same `electron/shamela/catalogue.ts` logic these
 * desktop calls use, so a scanned-image Shamela book translates through the
 * same PDF→image→vision pipeline on web as it already does on desktop.
 */
import { isDesktop } from "@/utils/environment";
import { bridgeBaseUrl, BRIDGE_TOKEN_KEY } from "@/core/shamela/shamelaClient";

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

const EMPTY_INFO: BookPdfInfo = { available: false, files: [], coverPage: null };

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
  if (!isDesktop()) {
    try {
      const token = localStorage.getItem(BRIDGE_TOKEN_KEY);
      const res = await fetch(`${bridgeBaseUrl()}/reader/pdfInfo?bookId=${encodeURIComponent(String(bookId))}`, {
        headers: token ? { "X-Bridge-Token": token } : undefined,
      });
      if (!res.ok) return EMPTY_INFO;
      return (await res.json()) as BookPdfInfo;
    } catch {
      return EMPTY_INFO;
    }
  }

  const masterDbPath = await getShamelaMasterDbPath();
  const api = window.electronAPI?.shamela;
  if (!masterDbPath || !api) return EMPTY_INFO;
  return api.bookPdfInfo(masterDbPath, Number(bookId));
}

/** Read one PDF's bytes so pdfjs can render it entirely in memory. */
export async function readBookPdf(bookId: string | number, fileIndex: number): Promise<Uint8Array | null> {
  if (!isDesktop()) {
    try {
      const token = localStorage.getItem(BRIDGE_TOKEN_KEY);
      const res = await fetch(
        `${bridgeBaseUrl()}/reader/pdf?bookId=${encodeURIComponent(String(bookId))}&fileIndex=${fileIndex}`,
        { headers: token ? { "X-Bridge-Token": token } : undefined },
      );
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  const masterDbPath = await getShamelaMasterDbPath();
  const api = window.electronAPI?.shamela;
  if (!masterDbPath || !api) return null;
  const info = await api.bookPdfInfo(masterDbPath, Number(bookId));
  const file = info.files.find((f) => f.fileIndex === fileIndex);
  if (!file) return null;
  return api.readBookPdf(masterDbPath, file.path);
}
