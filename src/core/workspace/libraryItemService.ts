import { supabase } from "@/integrations/supabase/client";
import type { LibraryItem } from "./types";

export type { LibraryItem };

export const libraryItemService = {
  async listItems(projectId?: string): Promise<LibraryItem[]> {
    let query = (supabase.from("library_items" as any) as any)
      .select("*")
      .order("created_at", { ascending: false });

    if (projectId) {
      query = query.eq("project_id", projectId);
    }

    const { data, error } = await query;
    if (error) {
      console.warn("[libraryItemService] failed to list library items:", error);
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
      console.error("[libraryItemService] create error:", error);
      return null;
    }
    return data as LibraryItem;
  },
};
