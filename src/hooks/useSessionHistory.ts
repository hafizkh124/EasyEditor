import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type SessionSection = "transcribe" | "speak" | "ocr" | "research";

export interface SessionHistoryItem {
  id: string;
  section: SessionSection;
  title: string;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
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

/**
 * Generic, section-scoped history of the signed-in user's sessions.
 * Silently no-ops if the user_sessions table is missing (pre-migration).
 */
export function useSessionHistory(section: SessionSection) {
  const { user } = useAuth();
  const [items, setItems] = useState<SessionHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState(true);

  const fetchItems = useCallback(async () => {
    if (!user) { setItems([]); return; }
    setLoading(true);
    try {
      const { data, error } = await fromUserSessions()
        .select("id, section, title, created_at, updated_at, metadata")
        .eq("user_id", user.id)
        .eq("section", section)
        .order("updated_at", { ascending: false });

      if (error) {
        if (import.meta.env.DEV) console.warn("[useSessionHistory]", error.message);
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

  const rename = async (id: string, title: string) => {
    if (!user) return false;
    const { error } = await fromUserSessions()
      .update({ title })
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) return false;
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, title } : i)));
    return true;
  };

  const remove = async (id: string) => {
    if (!user) return false;
    const { error } = await fromUserSessions()
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) return false;
    setItems((prev) => prev.filter((i) => i.id !== id));
    return true;
  };

  return { items, loading, available, refresh: fetchItems, rename, remove };
}
