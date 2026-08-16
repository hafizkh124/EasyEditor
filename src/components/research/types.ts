export interface Source {
  id: string;
  source_type: "url" | "pdf" | "docx";
  title: string;
  url?: string;
  storage_path?: string;
  created_at: string;
}

import type { AssistResult } from "@/lib/research/streamers";
import type { CitationItem } from "./CitationPanel";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /**
   * Present only when this assistant message was produced by a spelling/citations
   * assist pass (FR-1). Holds the structured payload so the renderer can show
   * inline highlights and offer dual-copy options without a re-query.
   */
  assist?: AssistResult;
  /**
   * The exact `sources_ready` citations for THIS message's query, in the same
   * order islamic-search numbered them (index N-1 == the model's [N] marker).
   * Deliberately NOT the session's accumulated `citations` list — that list
   * merges every turn's sources together, so its array index stops matching
   * a given answer's [N] markers as soon as a second query has run. Missing
   * on messages saved before this field existed.
   */
  sourceCitations?: CitationItem[];
}
