import { supabase } from "@/integrations/supabase/client";
import { taskRunService } from "@/core/workspace/taskRunService";

/**
 * Not a registry task: it runs on its own edge function and writes nothing
 * into the document, so it must not appear on the bubble/slash surfaces. It
 * still costs tokens, so it uses the same per-2000-character formula as
 * `calculateTaskCost` and is priced before it runs.
 */
export const GRAPH_EXTRACT_SLUG = "extract_entities";

export function estimateGraphExtractCost(charLength: number): number {
  return 5 * Math.max(1, Math.ceil(charLength / 2000));
}

export interface Entity {
  id: string;
  user_id: string;
  canonical_name: string;
  kind: "person" | "concept" | "book" | "location" | "event";
  aliases: string[];
  summary?: string;
  created_at: string;
}

export interface EntityRelation {
  id: string;
  user_id: string;
  source_entity_id: string;
  target_entity_id: string;
  relation_type: string;
  evidence_quote?: string;
  document_id?: string;
  library_item_id?: string;
  created_at: string;
  source_entity?: Entity;
  target_entity?: Entity;
}

export interface EntityBacklink {
  id: string;
  type: "document" | "library_item";
  title: string;
}

export interface EntityDetails {
  entity: Entity;
  outgoingRelations: EntityRelation[];
  incomingRelations: EntityRelation[];
  backlinks: EntityBacklink[];
}

export const graphService = {
  /**
   * Extract Knowledge Graph entities & relations from a text passage (SPEC-M4 FR-3.1).
   *
   * Logged to `task_runs` like every other paid AI action: an extraction that
   * leaves no trace is a charge the user cannot audit in the Trust tab
   * (SPEC-M3 FR-2.7, and Principle 5).
   */
  async extractGraphFromText(
    text: string,
    documentId?: string,
    libraryItemId?: string,
  ): Promise<{ entities_count: number; relations_count: number }> {
    const run = await taskRunService.createTaskRun({
      documentId,
      taskSlug: GRAPH_EXTRACT_SLUG,
      input: { chars: text.length, estimatedCost: estimateGraphExtractCost(text.length) },
    });

    try {
      const res = await supabase.functions.invoke("graph-extract", {
        body: { text, document_id: documentId, library_item_id: libraryItemId },
      });

      if (res.error) throw new Error(res.error.message || "گراف ایکسٹریکشن ناکام ہو گئی");

      if (run?.id) {
        await taskRunService.updateTaskRun(run.id, {
          status: "completed",
          output: res.data,
          tokensSpent: estimateGraphExtractCost(text.length),
        });
      }
      return res.data;
    } catch (e) {
      if (run?.id) {
        await taskRunService.updateTaskRun(run.id, {
          status: "failed",
          error: e instanceof Error ? e.message : "graph-extract failed",
        });
      }
      throw e;
    }
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
      console.error("[graphService] merge alias update failed:", aliasErr);
      return false;
    }

    // Repoint both directions before deleting, or the FK cascade would take
    // the evidence with it.
    for (const column of ["source_entity_id", "target_entity_id"]) {
      const { error } = await (supabase.from("entity_relations" as any) as any)
        .update({ [column]: keepId })
        .eq(column, absorbId);
      if (error) {
        console.error(`[graphService] merge repoint ${column} failed:`, error);
        return false;
      }
    }

    const { error: delErr } = await (supabase.from("entities" as any) as any)
      .delete()
      .eq("id", absorbId);
    if (delErr) {
      console.error("[graphService] merge delete failed:", delErr);
      return false;
    }
    return true;
  },

  /**
   * Search / list entities in personal Knowledge Graph.
   */
  async listEntities(searchQuery?: string): Promise<Entity[]> {
    let q = (supabase.from("entities" as any) as any)
      .select("*")
      .order("canonical_name", { ascending: true });

    if (searchQuery && searchQuery.trim()) {
      q = q.ilike("canonical_name", `%${searchQuery.trim()}%`);
    }

    const { data, error } = await q;
    if (error) {
      console.warn("[graphService] listEntities error:", error);
      return [];
    }
    return (data as Entity[]) || [];
  },

  /**
   * Get entity card details including incoming/outgoing relations & backlinks (SPEC-M4 FR-3.3, FR-3.4).
   */
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
};
