/**
 * Cloud implementations of the three small backends: identity, recipes, and
 * custom tasks. Each is only a handful of methods, so they share a file rather
 * than each getting one of their own (NFR-1 is a ceiling, not a target).
 *
 * Bodies moved verbatim from src/lib/recipes/recipeService.ts and
 * src/lib/tasks/customTasks.ts (M5.0).
 */
import { supabase } from "@/integrations/supabase/client";
import { getTaskBySlug } from "@/lib/tasks/registry";
import { BUILTIN_RECIPES } from "@/lib/recipes/builtinRecipes";
import type { IdentityBackend, RecipeBackend, CustomTaskBackend } from "../types";
import type { Recipe } from "@/lib/recipes/recipeService";
import type { CustomTaskRow } from "@/lib/tasks/customTasks";
import { translateStored } from "@/lib/i18n";

// ── Identity ────────────────────────────────────────────────────────────────

export const cloudIdentity: IdentityBackend = {
  async getCurrentUserId(): Promise<string | null> {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
  },
};

// ── Recipes ─────────────────────────────────────────────────────────────────

export const cloudRecipes: RecipeBackend = {
  /**
   * List available built-in and custom recipes (SPEC-M4 FR-4.1).
   * Falls back to the built-ins whenever the table is missing or empty, so a
   * fresh account still sees something useful.
   */
  async listRecipes(): Promise<Recipe[]> {
    try {
      const { data, error } = await (supabase.from("recipes" as any) as any)
        .select("*")
        .order("is_builtin", { ascending: false });

      if (error || !data || data.length === 0) {
        return BUILTIN_RECIPES;
      }
      return data as Recipe[];
    } catch {
      return BUILTIN_RECIPES;
    }
  },
};

// ── Custom tasks ────────────────────────────────────────────────────────────

/**
 * `ai_tasks` was added after `src/integrations/supabase/types.ts` was generated,
 * so the typed client does not know it. The cast is confined to this one helper
 * rather than sprinkled through every call; `CustomTaskRow` is the hand-written
 * contract, and it must match the migration.
 */
const aiTasks = () =>
  (supabase.from as unknown as (t: string) => ReturnType<typeof supabase.from>)("ai_tasks");

/** Slugify a user-supplied label into a stable, unique-per-user key. */
function toSlug(label: string, fallback: string): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return (base || fallback).slice(0, 48);
}

export const cloudCustomTasks: CustomTaskBackend = {
  async list(): Promise<CustomTaskRow[]> {
    const { data, error } = await aiTasks()
      .select("*")
      .is("archived_at", null)
      .order("created_at", { ascending: true });

    if (error) {
      console.warn("[cloudCustomTasks] list error:", error);
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
      console.error("[cloudCustomTasks] create error:", error);
      throw new Error(
        error.code === "23505"
          ? "اس نام کا ٹاسک پہلے سے موجود ہے — کوئی اور نام رکھیں۔"
          : translateStored("toast.task.save_failed"),
      );
    }
    return data as CustomTaskRow;
  },

  async update(id: string, patch: { label?: string; system_prompt?: string }): Promise<boolean> {
    const { error } = await aiTasks().update(patch).eq("id", id);
    if (error) {
      console.error("[cloudCustomTasks] update error:", error);
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
      console.error("[cloudCustomTasks] archive error:", error);
      return false;
    }
    return true;
  },
};
