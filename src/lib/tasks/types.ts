import type { TaskRunSource } from "@/core/workspace/types";

export type TaskEngine = "refine-text" | "client";
export type TaskScope = "selection" | "document" | "either";
export type TaskApplyMode = "inline" | "block" | "append" | "replace_document";
export type TaskOutputFormat = "text" | "html";
export type TaskSurface = "bubble" | "slash" | "library" | "toolbar";

export interface TaskCostModel {
  baseTokens: number;
  perKChars?: number;
}

export interface TaskDefinition {
  slug: string;
  labelKey: string; // Translation key or fallback Urdu string
  defaultLabel: string;
  engine: TaskEngine;
  actionName?: string; // Action name parameter for refine-text edge function
  /**
   * `ai_tasks.id` for a user-authored task. The server resolves the prompt from
   * this id; the prompt text is never sent by the client (FR-2.5).
   */
  taskId?: string;
  isCustom?: boolean;
  scope: TaskScope;
  applyMode: TaskApplyMode;
  outputFormat?: TaskOutputFormat;
  chunkable: boolean;
  producesSources: boolean;
  costModel: TaskCostModel;
  surfaces: TaskSurface[];
  clientFn?: (text: string) => string;
}

export interface ChunkProgress {
  total: number;
  done: number;
  failed: number;
  skipped: number;
}

export interface TaskRunResult {
  runId?: string;
  text?: string;
  html?: string;
  /** Same shape the run was persisted with, so callers need no re-mapping. */
  sources?: TaskRunSource[];
  confidence?: number | null;
  model?: string;
  tokensSpent?: number;
  partial?: boolean;
}
