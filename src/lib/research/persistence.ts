import { supabase } from "@/integrations/supabase/client";
import type { ChatMessage } from "@/components/research/types";
import type { CitationItem } from "@/components/research/CitationPanel";

type ResearchSessionRow = {
  id: string;
  user_id: string;
  title: string;
  mode: "general" | "islamic";
  messages: ChatMessage[];
  citations: CitationItem[];
  selected_domains: string[];
  updated_at: string;
};

// `research_sessions` may not be present in generated Supabase types if the
// migration has not been applied to this environment. These helpers isolate
// the untyped access to a single spot.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromSessions = () => (supabase.from as any)("research_sessions");

export async function upsertResearchSession(params: {
  id: string | null;
  userId: string;
  title: string;
  mode: "general" | "islamic";
  messages: ChatMessage[];
  citations: CitationItem[];
  selectedDomains: string[];
}): Promise<string | null> {
  const payload = {
    title: params.title,
    mode: params.mode,
    messages: params.messages,
    citations: params.citations,
    selected_domains: params.selectedDomains,
  };
  if (params.id) {
    await fromSessions()
      .update(payload)
      .eq("id", params.id)
      .eq("user_id", params.userId);
    return params.id;
  }
  const { data, error } = await fromSessions()
    .insert({ user_id: params.userId, ...payload })
    .select("id")
    .single();
  if (error || !data?.id) return null;
  return data.id as string;
}

export async function loadLatestResearchSession(
  userId: string,
  mode: "general" | "islamic",
): Promise<ResearchSessionRow | null> {
  const { data, error } = await fromSessions()
    .select("*")
    .eq("user_id", userId)
    .eq("mode", mode)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as ResearchSessionRow;
}

export async function deleteResearchSession(id: string, userId: string): Promise<void> {
  await fromSessions().delete().eq("id", id).eq("user_id", userId);
}

export type ResearchSessionSummary = {
  id:           string;
  title:        string;
  mode:         "general" | "islamic";
  updated_at:   string;
  message_count: number;
};

/** List recent sessions for the sidebar. Returns lightweight summaries — does
 * not pull `messages` / `citations` to keep the response small. */
export async function listResearchSessions(
  userId: string,
  limit = 50,
): Promise<ResearchSessionSummary[]> {
  const { data, error } = await fromSessions()
    .select("id, title, mode, updated_at, messages")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map((row) => ({
    id:            row.id,
    title:         row.title ?? "Untitled",
    mode:          row.mode ?? "general",
    updated_at:    row.updated_at,
    message_count: Array.isArray(row.messages) ? row.messages.length : 0,
  }));
}

/** Load a specific session by id (for sidebar click-to-resume). */
export async function loadResearchSession(
  id: string,
  userId: string,
): Promise<ResearchSessionRow | null> {
  const { data, error } = await fromSessions()
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as ResearchSessionRow;
}

type IncrementRpc = "increment_research_queries" | "increment_islamic_queries";

/**
 * @deprecated Token deduction is now handled server-side in edge functions.
 * Kept for backward compatibility — do not call from new code.
 */
export async function incrementQueryCount(
  rpc: IncrementRpc,
  userId: string,
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)(rpc, { p_user_id: userId });
  return !error;
}
