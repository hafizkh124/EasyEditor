/**
 * Cloud implementation of GraphBackend — Supabase.
 *
 * Bodies moved verbatim from src/lib/graph/graphService.ts (M5.0), MINUS
 * `extractGraphFromText`: that one calls `functions.invoke("graph-extract")`,
 * so it is an AI operation, not a data operation. It stays in graphService and
 * moves behind the AI adapter in M5.2.
 */
import { supabase } from "@/integrations/supabase/client";
import type { GraphBackend } from "../types";
import type { Entity, EntityRelation, EntityBacklink, EntityDetails } from "@/lib/graph/graphService";

export const cloudGraph: GraphBackend = {
  /** Search / list entities in the personal Knowledge Graph. */
  async listEntities(searchQuery?: string): Promise<Entity[]> {
    let q = (supabase.from("entities" as any) as any)
      .select("*")
      .order("canonical_name", { ascending: true });

    if (searchQuery && searchQuery.trim()) {
      q = q.ilike("canonical_name", `%${searchQuery.trim()}%`);
    }

    const { data, error } = await q;
    if (error) {
      console.warn("[cloudGraph] listEntities error:", error);
      return [];
    }
    return (data as Entity[]) || [];
  },

  /** Entity card details: relations both ways, plus backlinks (SPEC-M4 FR-3.4). */
  async getEntityDetails(entityId: string): Promise<EntityDetails | null> {
    const { data: entity, error: entErr } = await (supabase.from("entities" as any) as any)
      .select("*")
      .eq("id", entityId)
      .single();

    if (entErr || !entity) return null;

    const { data: outgoing } = await (supabase.from("entity_relations" as any) as any)
      .select("*, target_entity:entities!target_entity_id(*)")
      .eq("source_entity_id", entityId);

    const { data: incoming } = await (supabase.from("entity_relations" as any) as any)
      .select("*, source_entity:entities!source_entity_id(*)")
      .eq("target_entity_id", entityId);

    const allRelations = [...(outgoing || []), ...(incoming || [])];
    const docIds = Array.from(new Set(allRelations.map((r) => r.document_id).filter(Boolean)));
    const libIds = Array.from(new Set(allRelations.map((r) => r.library_item_id).filter(Boolean)));

    const backlinks: EntityBacklink[] = [];

    if (docIds.length > 0) {
      const { data: docs } = await (supabase.from("documents" as any) as any)
        .select("id, title")
        .in("id", docIds);

      for (const d of docs || []) {
        backlinks.push({ id: d.id, type: "document", title: d.title || "Untitled Document" });
      }
    }

    if (libIds.length > 0) {
      const { data: libs } = await (supabase.from("library_items" as any) as any)
        .select("id, title")
        .in("id", libIds);

      for (const l of libs || []) {
        backlinks.push({ id: l.id, type: "library_item", title: l.title || "Untitled File" });
      }
    }

    return {
      entity: entity as Entity,
      outgoingRelations: (outgoing as EntityRelation[]) || [],
      incomingRelations: (incoming as EntityRelation[]) || [],
      backlinks,
    };
  },

  /**
   * Merge one entity into another (SPEC-M4 FR-3.3).
   *
   * Only ever called from an explicit user action on a suggestion. The absorbed
   * name is kept as an alias so the merge stays reversible, and its relations
   * are repointed rather than deleted.
   */
  async mergeEntities(keepId: string, absorbId: string, mergedAliases: string[]): Promise<boolean> {
    if (keepId === absorbId) return false;

    const { error: aliasErr } = await (supabase.from("entities" as any) as any)
      .update({ aliases: mergedAliases })
      .eq("id", keepId);
    if (aliasErr) {
      console.error("[cloudGraph] merge alias update failed:", aliasErr);
      return false;
    }

    // Repoint both directions before deleting, or the FK cascade would take
    // the evidence with it.
    for (const column of ["source_entity_id", "target_entity_id"]) {
      const { error } = await (supabase.from("entity_relations" as any) as any)
        .update({ [column]: keepId })
        .eq(column, absorbId);
      if (error) {
        console.error(`[cloudGraph] merge repoint ${column} failed:`, error);
        return false;
      }
    }

    const { error: delErr } = await (supabase.from("entities" as any) as any)
      .delete()
      .eq("id", absorbId);
    if (delErr) {
      console.error("[cloudGraph] merge delete failed:", delErr);
      return false;
    }
    return true;
  },
};
