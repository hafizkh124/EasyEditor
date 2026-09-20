/**
 * Library chunk service — facade over the backend adapter (M5.0).
 * Implementation: src/core/backend/cloud/library.ts
 */
import { backendFacade } from "@/core/backend";
import type { LibraryItem } from "@/core/workspace/types";
import type { LibraryChunkInfo } from "@/core/backend/types";

const library = backendFacade("library");

export const libraryChunkService = {
  uploadLibraryFile: (file: File, kind: "book" | "ocr" | "audio" | "custom" = "book") =>
    library.uploadLibraryFile(file, kind),
  deleteLibraryItem: (itemId: string) => library.deleteLibraryItem(itemId),
  listLibraryItems: (): Promise<LibraryItem[]> => library.listLibraryItems(),
  listChunks: (itemId: string, limit?: number, offset?: number): Promise<LibraryChunkInfo[]> =>
    library.listChunks(itemId, limit, offset),
};
