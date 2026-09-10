import { useCallback, useEffect, useState } from "react";
import {
  listSearches,
  deleteSearch,
  clearSearches,
  SEARCH_HISTORY_CHANGED_EVENT,
  type SearchEntry,
} from "@/lib/history/searchHistory";

/** Plan §3.4 — the Searches sub-view of the History panel. Mirrors
 *  `useSessionHistory`: an `available` flag (false = not migrated / nowhere to
 *  store) and a `"search-history-changed"` listener. */
export function useSearchHistory() {
  const [entries, setEntries] = useState<SearchEntry[]>([]);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await listSearches();
    setEntries(r.entries);
    setAvailable(r.available);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const handler = () => void refresh();
    window.addEventListener(SEARCH_HISTORY_CHANGED_EVENT, handler);
    return () => window.removeEventListener(SEARCH_HISTORY_CHANGED_EVENT, handler);
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    await deleteSearch(id);
  }, []);

  const clear = useCallback(async () => {
    setEntries([]);
    await clearSearches();
  }, []);

  return { entries, available, loading, refresh, remove, clear };
}
