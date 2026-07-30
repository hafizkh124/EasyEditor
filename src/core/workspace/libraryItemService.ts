/**
 * Library item service — facade over the backend adapter (M5.0).
 * Implementation: src/core/backend/cloud/library.ts
 */
import { backendFacade } from "@/core/backend";
import type { LibraryItem } from "./types";

export type { LibraryItem };

const library = backendFacade("library");

export const libraryItemService = {
  listItems: (projectId?: string) => library.listItems(projectId),
  createItem: (item: Partial<LibraryItem> & { title: string }) => library.createItem(item),
};
