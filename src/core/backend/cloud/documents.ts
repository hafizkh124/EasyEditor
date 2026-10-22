/**
 * Cloud implementation of DocumentBackend — Supabase/Postgres.
 *
 * Bodies moved verbatim from src/core/workspace/documentService.ts (M5.0).
 * No behaviour changed: this is a relocation, not a rewrite.
 */
import { supabase } from "@/integrations/supabase/client";
import { extractPlainTextFromJSON, countWords } from "~shared/text/plainText";
import type { DocumentBackend } from "../types";
import type { Project, Document, DocumentVersion, ProjectKind } from "@/core/workspace/types";

export const cloudDocuments: DocumentBackend = {
  async listProjects(): Promise<Project[]> {
    const { data, error } = await supabase
      .from("projects" as any)
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) throw error;
    return (data as unknown as Project[]) || [];
  },

  async createProject(
    title: string,
    kind: ProjectKind = "general",
    meta?: Record<string, unknown>,
  ): Promise<Project> {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) throw new Error("Unauthenticated user");

    const { data, error } = await supabase
      .from("projects" as any)
      .insert({
        user_id: userData.user.id,
        title,
        kind,
        meta: meta || {},
      })
      .select()
      .single();

    if (error) throw error;
    return data as unknown as Project;
  },

  async getProject(id: string): Promise<Project | null> {
    const { data, error } = await supabase
      .from("projects" as any)
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    return (data as unknown as Project) || null;
  },

  async updateProject(id: string, updates: Partial<Pick<Project, "title" | "meta">>): Promise<Project> {
    const { data, error } = await supabase
      .from("projects" as any)
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return data as unknown as Project;
  },

  async listDocumentsIndex(projectIds: string[]): Promise<Document[]> {
    if (projectIds.length === 0) return [];
    const { data, error } = await supabase
      .from("documents" as any)
      .select(
        "id, project_id, user_id, title, doc_type, plain_text, sort_order, status, word_count, text_direction, created_at, updated_at",
      )
      .in("project_id", projectIds)
      .order("sort_order", { ascending: true })
      .order("updated_at", { ascending: false });

    if (error) throw error;
    return ((data as unknown as Document[]) || []).map((d) => ({ ...d, content_json: {} }));
  },

  async listDocuments(projectId: string): Promise<Document[]> {
    const { data, error } = await supabase
      .from("documents" as any)
      .select("*")
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true })
      .order("updated_at", { ascending: false });

    if (error) throw error;
    return (data as unknown as Document[]) || [];
  },

  async getDocument(id: string): Promise<Document | null> {
    const { data, error } = await supabase
      .from("documents" as any)
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    return (data as unknown as Document) || null;
  },

  /**
   * Most recently touched empty document in a project, if there is one.
   *
   * `/editor` creates a document on arrival so the user can just start typing.
   * Without this lookup every visit to the Editor tab would leave behind
   * another "Untitled Document", and the Library would fill up with blanks.
   */
  async findBlankDocument(projectId: string): Promise<Document | null> {
    const { data, error } = await supabase
      .from("documents" as any)
      .select("*")
      .eq("project_id", projectId)
      .eq("word_count", 0)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error) throw error;
    const rows = (data as unknown as Document[]) || [];
    return rows[0] ?? null;
  },

  async createDocument(
    projectId: string,
    title = "Untitled Document",
    contentJson: Record<string, unknown> = {},
  ): Promise<Document> {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) throw new Error("Unauthenticated user");

    const plainText = extractPlainTextFromJSON(contentJson);
    const wordCount = countWords(plainText);

    const { data, error } = await supabase
      .from("documents" as any)
      .insert({
        project_id: projectId,
        user_id: userData.user.id,
        title,
        content_json: contentJson,
        plain_text: plainText,
        word_count: wordCount,
      })
      .select()
      .single();

    if (error) throw error;
    return data as unknown as Document;
  },

  async updateDocument(
    id: string,
    updates: Partial<Pick<Document, "title" | "content_json" | "status" | "sort_order" | "text_direction">>,
  ): Promise<Document> {
    const payload: Record<string, unknown> = { ...updates };

    if (updates.content_json) {
      const plainText = extractPlainTextFromJSON(updates.content_json);
      payload.plain_text = plainText;
      payload.word_count = countWords(plainText);
    }

    const { data, error } = await supabase
      .from("documents" as any)
      .update(payload)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return data as unknown as Document;
  },

  async deleteDocument(id: string): Promise<void> {
    const { error } = await supabase
      .from("documents" as any)
      .delete()
      .eq("id", id);

    if (error) throw error;
  },

  async snapshotVersion(
    documentId: string,
    contentJson: Record<string, unknown>,
    label?: string,
  ): Promise<DocumentVersion> {
    const plainText = extractPlainTextFromJSON(contentJson);

    const { data, error } = await supabase
      .from("document_versions" as any)
      .insert({
        document_id: documentId,
        content_json: contentJson,
        plain_text: plainText,
        label: label || `Snapshot ${new Date().toLocaleString()}`,
      })
      .select()
      .single();

    if (error) throw error;
    return data as unknown as DocumentVersion;
  },

  async listDocumentVersions(documentId: string): Promise<DocumentVersion[]> {
    const { data, error } = await supabase
      .from("document_versions" as any)
      .select("*")
      .eq("document_id", documentId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data as unknown as DocumentVersion[]) || [];
  },
};
