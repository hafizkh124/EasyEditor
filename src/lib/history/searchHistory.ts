/**
 * Plan §3.4 — the workspace search log.
 *
 * Two backends: Supabase `search_history` for a signed-in user (degrades to
 * `available:false` until that Lovable-managed migration lands), and the local
 * SQLite mirror in Electron for logged-out / offline use. On web signed-out
 * there is nowhere to store it — `recordSearch` is then a no-op.
 */
import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";

const log = logger.child("searchHistory");

export type SearchKind = "shamela" | "corpus" | "jkhssn" | "resource" | "hadith";

export interface SearchEntry {
  id: string;
  kind: SearchKind | string;
  query: string;
  filters: Record<string, unknown>;
  resultCount: number | null;
  createdAt: string;
}

const CHANGED_EVENT = "search-history-changed";

function isDesktop(): boolean {
  return typeof window !== "undefined" && Boolean((window as { electronAPI?: unknown }).electronAPI);
}

async function localInvoke<T>(method: string, ...args: unknown[]): Promise<T> {
  return (window as unknown as { electronAPI: { invoke: (c: string, p: unknown) => Promise<T> } }).electronAPI.invoke(
    "workspace:invoke",
    { method, args },
  );
}

/** Fire-and-forget: record a search. Never throws into the caller. */
export async function recordSearch(entry: {
  kind: SearchKind | string;
  query: string;
  filters?: Record<string, unknown>;
  resultCount?: number | null;
}): Promise<void> {
  const query = entry.query.trim();
  if (!query) return;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      // Dedup client-side: skip if the same query+kind is the newest row < 30s old.
      const { data: last } = await (supabase.from as unknown as (t: string) => any)("search_history")
        .select("created_at")
        .eq("user_id", user.id)
        .eq("kind", entry.kind)
        .eq("query", query)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (last && Date.now() - new Date(last.created_at).getTime() < 30_000) return;
      const { error } = await (supabase.from as unknown as (t: string) => any)("search_history").insert({
        user_id: user.id,
        kind: entry.kind,
        query,
        filters: entry.filters ?? {},
        result_count: entry.resultCount ?? null,
      });
      if (error) throw error;
    } else if (isDesktop()) {
      await localInvoke("addSearch", { kind: entry.kind, query, filters: entry.filters ?? {}, resultCount: entry.resultCount ?? null });
    } else {
      return; // web + signed out — nowhere to store it
    }
    window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
  } catch (err) {
    log.debug("recordSearch failed (non-fatal)", { err });
  }
}

export interface SearchHistoryResult {
  available: boolean;
  entries: SearchEntry[];
}

export async function listSearches(limit = 60): Promise<SearchHistoryResult> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data, error } = await (supabase.from as unknown as (t: string) => any)("search_history")
        .select("id, kind, query, filters, result_count, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) return { available: false, entries: [] }; // table absent → not migrated yet
      return {
        available: true,
        entries: (data ?? []).map((r: any) => ({
          id: r.id, kind: r.kind, query: r.query,
          filters: r.filters ?? {}, resultCount: r.result_count ?? null, createdAt: r.created_at,
        })),
      };
    }
    if (isDesktop()) {
      const rows = await localInvoke<Array<{ id: string; kind: string; query: string; filters: Record<string, unknown>; resultCount: number | null; createdAt: string }>>("listSearches", limit);
      return { available: true, entries: rows };
    }
    return { available: false, entries: [] };
  } catch {
    return { available: false, entries: [] };
  }
}

export async function deleteSearch(id: string): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await (supabase.from as unknown as (t: string) => any)("search_history").delete().eq("user_id", user.id).eq("id", id);
    } else if (isDesktop()) {
      await localInvoke("removeSearch", id);
    }
    window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
  } catch { /* ignore */ }
}

export async function clearSearches(): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await (supabase.from as unknown as (t: string) => any)("search_history").delete().eq("user_id", user.id);
    } else if (isDesktop()) {
      await localInvoke("clearSearches");
    }
    window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
  } catch { /* ignore */ }
}

export { CHANGED_EVENT as SEARCH_HISTORY_CHANGED_EVENT };
