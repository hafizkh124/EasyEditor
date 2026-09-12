import { backendFacade } from "@/core/backend";
import type { CustomTaskBackend } from "@/core/backend";
import type { TaskDefinition } from "./types";

/**
 * M11 Phase 3 / M12 Phase H — custom prompts for the `+` hub (ADR-0047).
 * Rows are plain instruction text, optionally with {{placeholders}} the
 * user fills in by hand after insertion — nothing here parses or executes
 * a placeholder, it is inserted as literal text into the composer. Storage
 * reuses the same `ai_tasks` rows customTasks.ts already authors (see
 * `CustomPromptsPicker.tsx`, wired into AgentComposer.tsx): one table, one
 * authoring surface (Settings → Task Library), read here as canned prompts
 * to drop into a message rather than run as a text-refinement task.
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
