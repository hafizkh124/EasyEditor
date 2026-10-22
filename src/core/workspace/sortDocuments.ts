import type { Document } from "./types";

/** How the folder index orders documents: the folder's own order (drag), by name, or newest first. */
export type SortMode = "manual" | "name" | "date";

export function sortDocuments(docs: readonly Document[], mode: SortMode): Document[] {
  const list = [...docs];
  if (mode === "name") return list.sort((a, b) => a.title.localeCompare(b.title));
  if (mode === "date") return list.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  return list.sort((a, b) => a.sort_order - b.sort_order || Date.parse(b.updated_at) - Date.parse(a.updated_at));
}

