export interface Source {
  id: string;
  source_type: "url" | "pdf" | "docx";
  title: string;
  url?: string;
  storage_path?: string;
  created_at: string;
}

import type { AssistResult } from "@/lib/research/streamers";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /**
   * Present only when this assistant message was produced by a spelling/citations
   * assist pass (FR-1). Holds the structured payload so the renderer can show
   * inline highlights and offer dual-copy options without a re-query.
   */
  assist?: AssistResult;
}
