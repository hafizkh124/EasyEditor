import { supabase } from "@/integrations/supabase/client";
import type { LibraryItem } from "@/core/workspace/types";

export const libraryChunkService = {
  /**
   * Upload file to private `library-files` storage bucket and create `library_items` row.
   */
  async uploadLibraryFile(file: File, kind: "book" | "ocr" | "audio" | "custom" = "book"): Promise<LibraryItem | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const fileExt = file.name.split(".").pop()?.toLowerCase() || "pdf";
    const itemId = crypto.randomUUID();
    const storagePath = `${user.id}/${itemId}.${fileExt}`;

    // 1. Upload to library-files private bucket
    const { error: storageError } = await supabase.storage
      .from("library-files")
      .upload(storagePath, file, { upsert: true });

    if (storageError) {
      console.error("[libraryChunkService] Storage upload error:", storageError);
      throw storageError;
    }

    // 2. Insert into library_items
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
      console.error("[libraryChunkService] DB insert error:", dbError);
      throw dbError;
    }

    return item as LibraryItem;
  },

  /**
   * Delete library item (FR-2.9): removes DB row (cascades to library_chunks) AND storage file.
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
      console.error("[libraryChunkService] delete error:", error);
      return false;
    }
    return true;
  },

  async listLibraryItems(): Promise<LibraryItem[]> {
    const { data, error } = await (supabase.from("library_items" as any) as any)
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("[libraryChunkService] list error:", error);
      return [];
    }
    return (data as LibraryItem[]) || [];
  },
};
