import { useState, useEffect, useCallback } from "react";
import { libraryItemService } from "@/core/workspace/libraryItemService";

export interface ResolvedShamelaBook {
  /** The library item id currently selected in the workspace. */
  itemId: string | null;
  /** The Shamela numeric book id (e.g. "1001"), or null when not a Shamela book. */
  bookId: string | null;
  title: string;
  author?: string;
  loading: boolean;
  error: string | null;
}

const shamelaBookId = (itemId: string | null): string | null => {
  if (!itemId) return null;
  if (/^\d+$/.test(itemId)) return itemId;
  return null;
};

/**
 * Resolve the workspace's active selection to a Shamela book when possible.
 *
 * The Home tab opens a library item by `itemId`; a Shamela import stores its
 * source as `source_ref.shamelaBookId`. When that marker is present the Canvas
 * renders the reader instead of the editor. Plain documents and non-Shamela
 * library items resolve to `bookId === null`.
 */
export function useShamelaBook(itemId: string | null): ResolvedShamelaBook {
  const [book, setBook] = useState<ResolvedShamelaBook>({
    itemId,
    bookId: null,
    title: "",
    loading: false,
    error: null,
  });

  const resolve = useCallback(async (id: string | null) => {
    // Fast path: a bare numeric id is a direct Shamela book id (used by the
    // book-level routes before a library item has been created).
    const direct = shamelaBookId(id);
    if (direct) {
      setBook({ itemId: id, bookId: direct, title: "", loading: false, error: null });
      return;
    }
    if (!id) {
      setBook({ itemId: null, bookId: null, title: "", loading: false, error: null });
      return;
    }

    setBook((prev) => ({ ...prev, itemId: id, bookId: null, loading: true, error: null }));
    try {
      const item = await libraryItemService.getItem(id);
      const ref = (item?.source_ref ?? {}) as Record<string, unknown>;
      const bookIdRaw = ref.shamelaBookId;
      if (item && bookIdRaw != null) {
        setBook({
          itemId: id,
          bookId: String(bookIdRaw),
          title: item.title,
          author: typeof ref.author === "string" ? ref.author : undefined,
          loading: false,
          error: null,
        });
      } else {
        setBook({ itemId: id, bookId: null, title: item?.title ?? "", loading: false, error: null });
      }
    } catch (err: unknown) {
      console.warn("[useShamelaBook] resolve failed:", err);
      setBook((prev) => ({
        ...prev,
        itemId: id,
        bookId: null,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to resolve the selection.",
      }));
    }
  }, []);

  useEffect(() => {
    resolve(itemId);
  }, [itemId, resolve]);

  return book;
}
