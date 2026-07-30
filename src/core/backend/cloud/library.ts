/**
 * Cloud implementation of LibraryBackend — Supabase tables + storage bucket.
 *
 * Bodies moved verbatim from src/core/workspace/libraryItemService.ts and
 * src/lib/corpus/libraryChunkService.ts (M5.0). The two were always one
 * concern split across two files; the interface reunites them.
 */
import { supabase } from "@/integrations/supabase/client";
import type { LibraryBackend } from "../types";
import type { LibraryItem } from "@/core/workspace/types";

export const cloudLibrary: LibraryBackend = {
  async listItems(projectId?: string): Promise<LibraryItem[]> {
    let query = (supabase.from("library_items" as any) as any)
      .select("*")
      .order("created_at", { ascending: false });

    if (projectId) {
      query = query.eq("project_id", projectId);
    }

    const { data, error } = await query;
    if (error) {
      console.warn("[cloudLibrary] failed to list library items:", error);
      return [];
    }
    return (data as LibraryItem[]) || [];
  },

  async createItem(item: Partial<LibraryItem> & { title: string }): Promise<LibraryItem | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await (supabase.from("library_items" as any) as any)
      .insert({
        title: item.title,
        user_id: user.id,
        project_id: item.project_id || null,
        kind: item.kind || "note",
        source_ref: item.source_ref || {},
        storage_path: item.storage_path || null,
        meta: item.meta || {},
      })
      .select()
      .single();

    if (error) {
      console.error("[cloudLibrary] create error:", error);
      return null;
    }
    return data as LibraryItem;
  },

  /**
   * Upload file to the private `library-files` bucket and create the
   * `library_items` row that points at it.
   */
  async uploadLibraryFile(
    file: File,
    kind: "book" | "ocr" | "audio" | "custom" = "book",
  ): Promise<LibraryItem | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const fileExt = file.name.split(".").pop()?.toLowerCase() || "pdf";
    const itemId = crypto.randomUUID();
    const storagePath = `${user.id}/${itemId}.${fileExt}`;

    const { error: storageError } = await supabase.storage
      .from("library-files")
      .upload(storagePath, file, { upsert: true });

    if (storageError) {
      console.error("[cloudLibrary] Storage upload error:", storageError);
      throw storageError;
    }

    const title = file.name.replace(/\.[^/.]+$/, "");
    const { data: item, error: dbError } = await (supabase.from("library_items" as any) as any)
      .insert({
        id: itemId,
        user_id: user.id,
        kind,
        title,
        storage_path: storagePath,
        meta: { ingest: { status: "pending", progress: 0 } },
      })
      .select()
      .single();

    if (dbError) {
      console.error("[cloudLibrary] DB insert error:", dbError);
      throw dbError;
    }

    return item as LibraryItem;
  },

  /**
   * Delete a library item (SPEC-M4 FR-2.9): removes the DB row (which cascades
   * to library_chunks) AND the stored file. No orphaned objects, no orphaned
   * embeddings.
   */
  async deleteLibraryItem(itemId: string): Promise<boolean> {
    const { data: item } = await (supabase.from("library_items" as any) as any)
      .select("storage_path")
      .eq("id", itemId)
      .single();

    if (item?.storage_path) {
      await supabase.storage.from("library-files").remove([item.storage_path]);
    }

    const { error } = await (supabase.from("library_items" as any) as any)
      .delete()
      .eq("id", itemId);

    if (error) {
      console.error("[cloudLibrary] delete error:", error);
      return false;
    }
    return true;
  },

  async listLibraryItems(): Promise<LibraryItem[]> {
    const { data, error } = await (supabase.from("library_items" as any) as any)
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("[cloudLibrary] list error:", error);
      return [];
    }
    return (data as LibraryItem[]) || [];
  },
};
