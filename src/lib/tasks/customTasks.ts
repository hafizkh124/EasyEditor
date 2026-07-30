import { backendFacade } from "@/core/backend";
import type { CustomTaskBackend } from "@/core/backend";
import type { TaskDefinition } from "./types";

/**
 * User-authored tasks (SPEC-M3 FR-2.4).
 *
 * Only *custom* tasks live in the database. The eleven built-ins stay in the
 * client registry because the server already owns their prompts — a DB copy
 * would be a second source of truth that silently drifts from the prompt that
 * actually runs.
 *
 * Authoring is deliberately narrow: duplicate a built-in and edit its prompt and
 * name. There is no free-form prompt editor.
 */

export interface CustomTaskRow {
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
export interface CustomTaskDefinition extends TaskDefinition {
  taskId: string;
  isCustom: true;
}

export function rowToDefinition(row: CustomTaskRow): CustomTaskDefinition {
  return {
    slug: row.slug,
    labelKey: `tasks.custom.${row.slug}`,
    defaultLabel: row.label,
    engine: "refine-text",
    // The prompt is resolved server-side from `taskId`; no action name and, by
    // design, no prompt text ever crosses the wire.
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
 * Facade over the backend adapter (M5.0).
 * Implementation: src/core/backend/cloud/misc.ts
 */
export const customTaskService: CustomTaskBackend = backendFacade("customTasks");
