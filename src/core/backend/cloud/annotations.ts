/**
 * Cloud implementation of AnnotationBackend — Supabase.
 * Bodies moved verbatim from src/core/workspace/annotationService.ts (M5.0).
 */
import { supabase } from "@/integrations/supabase/client";
import type { AnnotationBackend } from "../types";
import type { AnnotationItem } from "@/core/workspace/annotationService";

export const cloudAnnotations: AnnotationBackend = {
  async createAnnotation(params: {
    documentId: string;
    quote: string;
    note: string;
    color?: string;
  }): Promise<AnnotationItem | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await (supabase.from("annotations" as any) as any)
      .insert({
        document_id: params.documentId,
        user_id: user.id,
        anchor: { quote: params.quote, isDetached: false },
        note: params.note,
        color: params.color || "yellow",
      })
      .select()
      .single();

    if (error) {
      console.error("[cloudAnnotations] create error:", error);
      return null;
    }
    return data as AnnotationItem;
  },

  async updateAnnotation(
    id: string,
    params: { note?: string; anchor?: { quote: string; isDetached?: boolean } },
  ): Promise<boolean> {
    const payload: Record<string, unknown> = {};
    if (params.note) payload.note = params.note;
    if (params.anchor) payload.anchor = params.anchor;

    const { error } = await (supabase.from("annotations" as any) as any)
      .update(payload)
      .eq("id", id);

    if (error) {
      console.error("[cloudAnnotations] update error:", error);
      return false;
    }
    return true;
  },

  async deleteAnnotation(id: string): Promise<boolean> {
    const { error } = await (supabase.from("annotations" as any) as any)
      .delete()
      .eq("id", id);

    if (error) {
      console.error("[cloudAnnotations] delete error:", error);
      return false;
    }
    return true;
  },

  async listAnnotations(documentId: string): Promise<AnnotationItem[]> {
    const { data, error } = await (supabase.from("annotations" as any) as any)
      .select("*")
      .eq("document_id", documentId)
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("[cloudAnnotations] list error:", error);
      return [];
    }
    return (data as AnnotationItem[]) || [];
  },
};
