import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logger } from "@/lib/logger";

const log = logger.child("useSessionHistory");

export type SessionSection = "transcribe" | "speak" | "ocr" | "research" | "editor" | "translate";

export interface SessionHistoryItem {
  id: string;
  section: SessionSection;
  title: string;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
  /** Research chats only: the folder the chat belongs to, if any. */
  project_id?: string | null;
}

interface UserSessionRow {
  id: string;
  section: SessionSection;
  title: string;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown> | null;
}

// Supabase generated types won't include user_sessions until migrations + typegen
// are re-run. Cast minimally here; lib-level escape hatch per Phase 1 decision.
const fromUserSessions = () =>
  (supabase.from as unknown as (table: string) => ReturnType<typeof supabase.from>)("user_sessions");
// Research has its own dedicated table (`research_sessions`) populated by
// `src/lib/research/persistence.ts`. We unify it into the same generic
// history UI by reading from there when `section === "research"`.
const fromResearchSessions = () =>
  (supabase.from as unknown as (table: string) => ReturnType<typeof supabase.from>)("research_sessions");

/**
 * Generic, section-scoped history of the signed-in user's sessions.
 * Silently no-ops if the underlying table is missing (pre-migration).
 *
 * For section === "research", reads from `research_sessions` (separate table
 * owned by the Research chat hook) and projects each row into the common
 * SessionHistoryItem shape.
 */
export function useSessionHistory(section: SessionSection) {
  const { user } = useAuth();
  const [items, setItems] = useState<SessionHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState(true);

  const fetchItems = useCallback(async () => {
    if (!user) {
      // A desktop with no account still keeps its chats, in the local
      // database (see lib/sessions/store.ts) — list those.
      if (section === "research" && typeof window !== "undefined" && window.electronAPI?.invoke) {
        setLoading(true);
        try {
          const rows = (await window.electronAPI.invoke("workspace:invoke", { method: "listResearchSessions", args: [] })) as
            | Array<{ id: string; title: string; mode: string; project_id?: string | null; created_at?: string; updated_at: string }>
            | null;
          setItems((rows ?? []).map((r) => ({
            id: r.id,
            section: "research" as const,
            title: r.title ?? "Untitled",
            created_at: r.created_at ?? r.updated_at,
            updated_at: r.updated_at,
            metadata: { mode: r.mode },
            project_id: r.project_id ?? null,
          })));
        } catch {
          setItems([]);
        } finally {
          setLoading(false);
        }
        return;
      }
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      if (section === "research") {
        // "*" rather than a column list, so a database that has not run the
        // `project_id` migration yet still lists its chats.
        const { data, error } = await fromResearchSessions()
          .select("*")
          .eq("user_id", user.id)
          .order("updated_at", { ascending: false });
        if (error) {
          log.debug("research_sessions", { detail: error.message });
          setAvailable(false);
          setItems([]);
          return;
        }
         
        const rows = (data ?? []) as any[];
        setItems(rows.map((r) => ({
          id:         r.id,
          section:    "research" as const,
          title:      r.title ?? "Untitled",
          created_at: r.created_at,
          updated_at: r.updated_at,
          metadata:   { mode: r.mode },
          project_id: r.project_id ?? null,
        })));
        return;
      }

      const { data, error } = await fromUserSessions()
        .select("id, section, title, created_at, updated_at, metadata")
        .eq("user_id", user.id)
        .eq("section", section)
        .order("updated_at", { ascending: false });

      if (error) {
        log.debug("history fetch failed", { detail: error.message });
        setAvailable(false);
        setItems([]);
        return;
      }
      const rows = (data ?? []) as UserSessionRow[];
      setItems(rows.map((r) => ({ ...r, metadata: r.metadata ?? {} })));
    } finally {
      setLoading(false);
    }
  }, [user, section]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  // Cross-component refresh signal. Pages (e.g. Research) dispatch
  // `session-history-changed` after writing a new row so the sidebar
  // updates without a manual reload.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ section?: SessionSection }>).detail;
      if (!detail?.section || detail.section === section) {
        fetchItems();
      }
    };
    window.addEventListener("session-history-changed", handler);
    return () => window.removeEventListener("session-history-changed", handler);
  }, [fetchItems, section]);

  const rename = async (id: string, title: string) => {
    if (!user) return false;
    const table = section === "research" ? fromResearchSessions() : fromUserSessions();
    const { error } = await table
      .update({ title })
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) return false;
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, title } : i)));
    return true;
  };

  const remove = async (id: string) => {
    if (!user) return false;
    const table = section === "research" ? fromResearchSessions() : fromUserSessions();
    const { error } = await table
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) return false;
    setItems((prev) => prev.filter((i) => i.id !== id));
    return true;
  };

  return { items, loading, available, refresh: fetchItems, rename, remove };
}
