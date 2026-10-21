import { useMemo } from "react";
import { useSessionHistory } from "@/hooks/useSessionHistory";
import { useAllDocuments } from "@/core/workspace/useAllDocuments";

/**
 * The single recent list (SYSTEM-2026 §3): research chats and documents
 * together, newest first. Home and the sidebar both read it, so they can never
 * disagree about what "recent" means.
 */

export interface RecentItem {
  id: string;
  kind: "chat" | "document";
  title: string;
  updatedAt: string;
  to: string;
}

export function useRecentItems(limit: number) {
  const sessions = useSessionHistory("research");
  const documents = useAllDocuments();

  const items = useMemo<RecentItem[]>(() => {
    const chats: RecentItem[] = sessions.items.map((s) => ({
      id: `chat:${s.id}`,
      kind: "chat",
      title: s.title,
      updatedAt: s.updated_at,
      to: `/workspace?panel=research&session=${encodeURIComponent(s.id)}`,
    }));
    const docs: RecentItem[] = documents.allDocs.map((d) => ({
      id: `doc:${d.id}`,
      kind: "document",
      title: d.title,
      updatedAt: d.updated_at,
      to: `/workspace/${d.id}`,
    }));
    return [...chats, ...docs]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, limit);
  }, [sessions.items, documents.allDocs, limit]);

  return { items, loading: (sessions.loading || documents.loading) && items.length === 0 };
}
