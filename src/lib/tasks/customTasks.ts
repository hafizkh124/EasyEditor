import { supabase } from "@/integrations/supabase/client";
import { getTaskBySlug } from "./registry";
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
 * `ai_tasks` was added after `src/integrations/supabase/types.ts` was generated,
 * so the typed client does not know it. The cast is confined to this one helper
 * rather than sprinkled through every call; `CustomTaskRow` above is the
 * hand-written contract, and it must match the migration.
 */
const aiTasks = () => (supabase.from as unknown as (t: string) => ReturnType<typeof supabase.from>)("ai_tasks");

/** Slugify a user-supplied label into a stable, unique-per-user key. */
function toSlug(label: string, fallback: string): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return (base || fallback).slice(0, 48);
}

export const customTaskService = {
  async list(): Promise<CustomTaskRow[]> {
    const { data, error } = await aiTasks()
      .select("*")
      .is("archived_at", null)
      .order("created_at", { ascending: true });

    if (error) {
      console.warn("[customTaskService] list error:", error);
      return [];
    }
    return (data as CustomTaskRow[]) ?? [];
  },

  /**
   * Create a custom task by copying a built-in's behaviour flags and letting the
   * user supply the label and prompt. Copying the flags (rather than asking) is
   * what keeps a custom "citations" variant chunkable and source-producing.
   */
  async createFromBuiltin(
    baseSlug: string,
    label: string,
    systemPrompt: string,
  ): Promise<CustomTaskRow | null> {
    const base = getTaskBySlug(baseSlug);
    if (!base) throw new Error(`بنیادی ٹاسک '${baseSlug}' موجود نہیں۔`);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("لاگ اِن ضروری ہے۔");

    const { data, error } = await aiTasks()
      .insert({
        user_id: user.id,
        slug: toSlug(label, `${baseSlug}-copy-${Date.now().toString(36)}`),
        label: label.trim(),
        system_prompt: systemPrompt.trim(),
        base_task_slug: baseSlug,
        scope: base.scope,
        apply_mode: base.applyMode,
        output_format: base.outputFormat ?? "text",
        chunkable: base.chunkable,
        produces_sources: base.producesSources,
      })
      .select()
      .single();

    if (error) {
      console.error("[customTaskService] create error:", error);
      throw new Error(
        error.code === "23505"
          ? "اس نام کا ٹاسک پہلے سے موجود ہے — کوئی اور نام رکھیں۔"
          : "ٹاسک محفوظ نہ ہو سکا۔",
      );
    }
    return data as CustomTaskRow;
  },

  async update(id: string, patch: { label?: string; system_prompt?: string }): Promise<boolean> {
    const { error } = await aiTasks().update(patch).eq("id", id);
    if (error) {
      console.error("[customTaskService] update error:", error);
      return false;
    }
    return true;
  },

  /** Archive rather than delete, so old `task_runs` keep a resolvable name. */
  async archive(id: string): Promise<boolean> {
    const { error } = await aiTasks()
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      console.error("[customTaskService] archive error:", error);
      return false;
    }
    return true;
  },
};
