import { backendFacade } from "@/core/backend";
import type { CustomTaskBackend } from "@/core/backend";
import type { TaskDefinition } from "./types";

/**
 * M11 Phase 3 — custom prompts for the `+` hub (ADR-0047).
 * User-authored prompts with local text + {{placeholders}} — no network,
 * no code execution. Reuses the existing customTasks infrastructure
 * (shared pattern from src/lib/tasks/customTasks.ts).
 */

export interface CustomPromptRow {
  id: string;
  user_id: string;
  slug: string;
  label: string;
  system_prompt: string;
  base_task_slug: string | null;
  scope: "selection" | "document" | "either";
  apply_mode: "inline" | "block" | "append" | "replace_document";
  output_format: "text" | "html";
  chunkable: boolean;
  produces_sources: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A registry entry backed by an `ai_tasks` row. */
export interface CustomPromptDefinition extends TaskDefinition {
  taskId: string;
  isCustom: true;
}

export function rowToPromptDefinition(row: CustomPromptRow): CustomPromptDefinition {
  return {
    slug: row.slug,
    labelKey: `prompts.custom.${row.slug}`,
    defaultLabel: row.label,
    engine: "refine-text",
    taskId: row.id,
    isCustom: true,
    scope: row.scope,
    applyMode: row.apply_mode,
    outputFormat: row.output_format,
    chunkable: row.chunkable,
    producesSources: row.produces_sources,
    costModel: { baseTokens: 5 },
    surfaces: ["bubble", "slash", "library"],
  };
}

/**
 * Facade over the backend adapter.
 * Implementation: src/core/backend/cloud/misc.ts
 */
export const customPromptService: CustomTaskBackend = backendFacade("customTasks");
