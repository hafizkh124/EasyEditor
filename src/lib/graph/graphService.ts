// AI call, not a data call: `extractGraphFromText` invokes the `graph-extract`
// edge function. The AI adapter (M5.2) routes it through the right runtime.
import { callEdgeFunction } from "@/core/ai/aiAdapter";
import { taskRunService } from "@/core/workspace/taskRunService";
import { backendFacade } from "@/core/backend";

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

const graphData = backendFacade("graph");

export const graphService = {
  /**
   * Extract Knowledge Graph entities & relations from a text passage (SPEC-M4 FR-3.1).
   *
   * Logged to `task_runs` like every other paid AI action: an extraction that
   * leaves no trace is a charge the user cannot audit in the Trust tab
   * (SPEC-M3 FR-2.7, and Principle 5).
   *
   * NOTE: this is an AI call, not a data operation, which is why it stays here
   * rather than moving into WorkspaceBackend. It moves behind the AI adapter in
   * M5.2 alongside the other `functions.invoke` call sites.
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
      const res = await callEdgeFunction("graph-extract", {
        text, document_id: documentId, library_item_id: libraryItemId,
      });

      if (res.error) throw new Error(res.error.message || "گراف ایکسٹریکشن ناکام ہو گئی");

      const data = res.data as { entities_count: number; relations_count: number };

      if (run?.id) {
        await taskRunService.updateTaskRun(run.id, {
          status: "completed",
          output: data as unknown as Record<string, unknown>,
          tokensSpent: estimateGraphExtractCost(text.length),
        });
      }
      return data;
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

  // ── Data operations — delegated to the backend adapter (M5.0) ─────────────
  // Implementation: src/core/backend/cloud/graph.ts

  listEntities: (searchQuery?: string) => graphData.listEntities(searchQuery),
  getEntityDetails: (entityId: string) => graphData.getEntityDetails(entityId),
  mergeEntities: (keepId: string, absorbId: string, mergedAliases: string[]) =>
    graphData.mergeEntities(keepId, absorbId, mergedAliases),
};
