import type { GlossaryEntry, TranslationStyle } from "./glossary";

/**
 * Where book translations are kept (SYSTEM-2026 §6, §10): the signed-in
 * account's tables, or — on a desktop that is not signed in, translating with
 * its own key — this computer. Same shape either way, so the translator,
 * Files → Results and "take a glossary from an earlier translation" do not
 * care which.
 */

export interface TranslationProject {
  id: string;
  title: string;
  source_lang: string;
  target_lang: string;
  genre: string;
  status: string;
  source_ref: string | null;
  /** The workspace folder it was started from. */
  project_id?: string | null;
  style?: TranslationStyle | null;
  glossary?: GlossaryEntry[] | unknown;
  updated_at: string;
}

export interface TranslationChunk {
  project_id: string;
  chunk_index: number;
  source_text: string;
  translated_text: string | null;
  status: string;
  reviewed?: number[] | null;
}

export type NewTranslationProject = Omit<TranslationProject, "id" | "updated_at">;

export interface TranslationStore {
  /** "account" or "device" — where it lives, for the UI to say so. */
  readonly kind: "account" | "device";
  createProject(row: NewTranslationProject): Promise<string>;
  updateProject(id: string, patch: Partial<NewTranslationProject>): Promise<void>;
  getProject(id: string): Promise<TranslationProject | null>;
  /** Newest first. */
  listProjects(limit?: number): Promise<TranslationProject[]>;
  upsertChunk(row: TranslationChunk): Promise<void>;
  listChunks(projectId: string): Promise<TranslationChunk[]>;
}
