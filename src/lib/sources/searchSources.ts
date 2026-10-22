import { getShamelaClient } from "@/core/shamela/shamelaClient";
import { libraryChunkService } from "@/lib/corpus/libraryChunkService";
import { logger } from "@/lib/logger";
import type { PinnedSource } from "./pinnedSources";

const log = logger.child("searchSources");

/**
 * Book-level sources matching a query: Shamela books, JKHSSN books (desktop)
 * and the user's own uploaded files. Each source is optional — one that is not
 * reachable on this device simply adds nothing.
 */
export async function searchSources(query: string, limit = 6): Promise<PinnedSource[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const needle = q.toLocaleLowerCase();

  const shamela = getShamelaClient()
    .searchBooks(q, limit)
    .then((books) => books.map((b) => ({ ref: `shamela:${b.id}`, label: b.title, sublabel: b.author ?? undefined })))
    .catch((err: unknown) => {
      log.debug("shamela search failed", { err });
      return [] as PinnedSource[];
    });

  const jk = typeof window !== "undefined" ? window.electronAPI?.jkhssn : undefined;
  const jkhssn = jk?.searchBooks
    ? jk
        .searchBooks(q, Math.min(limit, 4))
        .then((hits) => hits.map((h) => ({ ref: `jkhssn:${h.id}`, label: h.title, sublabel: "جوامع الكلم" })))
        .catch(() => [] as PinnedSource[])
    : Promise.resolve([] as PinnedSource[]);

  const corpus = libraryChunkService
    .listLibraryItems()
    .then((items) =>
      items
        .filter((item) => item.title.toLocaleLowerCase().includes(needle))
        .slice(0, limit)
        .map((item) => ({ ref: `corpus:${item.id}`, label: item.title, sublabel: "میری فائل" })),
    )
    .catch(() => [] as PinnedSource[]);

  return (await Promise.all([shamela, jkhssn, corpus])).flat();
}
