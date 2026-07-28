/**
 * Workspace Core Types — Easy Editor 2.0
 */

export type ProjectKind = "research" | "book" | "translation" | "general";
export type DocumentStatus = "draft" | "in_review" | "final" | "archived";
export type LibraryItemKind = "book" | "pdf" | "audio" | "ocr" | "reference" | "note";
export type TaskRunStatus = "pending" | "running" | "completed" | "failed";

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

export interface TaskRun {
  id: string;
  user_id: string;
  project_id?: string | null;
  document_id?: string | null;
  task_slug: string;
  status: TaskRunStatus;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  sources?: Record<string, unknown> | null;
  confidence?: number | null;
  model?: string | null;
  tokens_spent?: number | null;
  created_at: string;
}
