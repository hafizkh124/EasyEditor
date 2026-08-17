/**
 * Workspace Core Types — Easy Editor 2.0
 */

export type ProjectKind = "research" | "book" | "translation" | "general";
export type DocumentStatus = "draft" | "in_review" | "final" | "archived";
export type LibraryItemKind = "book" | "pdf" | "audio" | "ocr" | "reference" | "note";
export type TaskRunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface Project {
  id: string;
  user_id: string;
  title: string;
  kind: ProjectKind;
  status: string;
  genre?: string | null;
  meta?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface Document {
  id: string;
  project_id: string;
  user_id: string;
  title: string;
  doc_type: string;
  content_json: Record<string, unknown>;
  plain_text: string;
  sort_order: number;
  status: DocumentStatus;
  word_count: number;
  /**
   * Explicit writing direction. `null` means undecided — the editor detects it
   * from the content, which is what every document did before this column
   * existed. A value is stored only once the direction is actually known (the
   * author toggled it, or a new document was created from unambiguous text),
   * so a stored value is a decision and never a guess.
   */
  text_direction: "rtl" | "ltr" | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentVersion {
  id: string;
  document_id: string;
  content_json: Record<string, unknown>;
  plain_text: string;
  label?: string | null;
  created_at: string;
}

export interface LibraryItem {
  id: string;
  user_id: string;
  project_id?: string | null;
  kind: LibraryItemKind;
  title: string;
  source_ref?: Record<string, unknown> | null;
  storage_path?: string | null;
  meta?: Record<string, unknown> | null;
  created_at: string;
  updated_at?: string | null;
}

export interface Annotation {
  id: string;
  document_id: string;
  user_id: string;
  anchor: Record<string, unknown>;
  note: string;
  color?: string | null;
  created_at: string;
}

/** One retrieved source, as `refine-text` stores it in `task_runs.sources`. */
export interface TaskRunSource {
  domain: string;
  reference: string;
  citation_ref?: Record<string, unknown>;
  source_url?: string | null;
  snippet?: string;
  score?: number;
  channels?: string[];
}

export interface TaskRun {
  id: string;
  user_id: string;
  project_id?: string | null;
  document_id?: string | null;
  task_slug: string;
  status: TaskRunStatus;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  /** JSONB column, `DEFAULT '[]'` — an array of retrieved sources, not an object. */
  sources?: TaskRunSource[] | null;
  confidence?: number | null;
  model?: string | null;
  tokens_spent?: number | null;
  /** Chunked-run progress; `{}` until a chunked run writes to it (M3.4). */
  progress?: Record<string, number> | null;
  error?: string | null;
  created_at: string;
  updated_at?: string | null;
}
