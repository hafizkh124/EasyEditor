import { BookOpenCheck, Layers, MessageCircleQuestion, ScrollText, Sparkles, UserPen } from "lucide-react";
import type { Recipe } from "@/lib/recipes/recipeService";
import type { TaskDefinition } from "@/lib/tasks/types";
import type { CustomTaskRow } from "@/lib/tasks/customTasks";
import type { ScholarlyPromptDef } from "@/lib/prompts/promptsRegistry";
import type { Playbook } from "~shared/playbooks/registry";
import { GRILL_ME } from "./grillMe";
import type { Skill, SkillPlace } from "./types";

/**
 * The single skills list (SYSTEM-2026 §7), built from the sources that used to
 * be separate menus. Pure, so the rules are testable without a backend:
 *
 * - Built-in AI tasks run in the editor. A task that appends to the whole
 *   document (section summaries) is left out: the editor's runner replaces
 *   the selection, so it would overwrite the document instead.
 * - My skills (`ai_tasks` rows) run in the editor as a task and, in the chat,
 *   insert their instruction.
 * - Scholarly prompts and "مجھ سے پوچھو" fill an instruction into the chat.
 * - Playbooks need the desktop agent; on the web they are absent, not dead.
 * - Recipes run their steps over the open document, so they are editor
 *   skills. Only recipes that pass `validateRecipe` are passed in.
 *
 * Order is what the `/` menus show: guided first, then built-in, then mine,
 * then multi-step.
 */

export interface SkillSources {
  tasks: readonly TaskDefinition[];
  customRows: readonly CustomTaskRow[];
  scholarlyPrompts: readonly ScholarlyPromptDef[];
  /** `null` where the agent cannot run playbooks (the web). */
  playbooks: readonly Playbook[] | null;
  /** Runnable recipes only. */
  recipes?: readonly Recipe[];
}

/** False for a task that appends to the whole document, which the editor's runner cannot do. */
export const runsInEditor = (task: Pick<TaskDefinition, "scope" | "applyMode">) =>
  !(task.scope === "document" && task.applyMode === "append");

export function buildSkills({ tasks, customRows, scholarlyPrompts, playbooks, recipes = [] }: SkillSources): Skill[] {
  const guided: Skill = {
    id: `guided:${GRILL_ME.id}`,
    kind: "guided",
    origin: "builtin",
    label: GRILL_ME.titleUr,
    description: GRILL_ME.descriptionUr,
    icon: MessageCircleQuestion,
    places: ["chat"],
    prompt: GRILL_ME,
  };

  const builtinEdits: Skill[] = tasks
    .filter((task) => !task.isCustom && task.surfaces.includes("slash") && runsInEditor(task))
    .map((task) => ({
      id: `task:${task.slug}`,
      kind: "edit",
      origin: "builtin",
      label: task.defaultLabel,
      icon: Sparkles,
      places: ["editor"],
      taskSlug: task.slug,
    }));

  const prompts: Skill[] = scholarlyPrompts.map((p) => ({
    id: `prompt:${p.id}`,
    kind: "prompt",
    origin: "builtin",
    label: p.titleUr,
    description: p.descriptionUr,
    icon: BookOpenCheck,
    places: ["chat"],
    prompt: p,
  }));

  const mine: Skill[] = customRows
    .filter((row) => !row.archived_at)
    .map((row) => {
      const places: SkillPlace[] = runsInEditor({ scope: row.scope, applyMode: row.apply_mode }) ? ["editor", "chat"] : ["chat"];
      return {
        id: `mine:${row.id}`,
        kind: "edit",
        origin: "mine",
        label: row.label,
        icon: UserPen,
        places,
        taskSlug: row.slug,
        promptText: row.system_prompt,
        rowId: row.id,
        baseTaskSlug: row.base_task_slug,
      };
    });

  const workflows: Skill[] = (playbooks ?? []).map((pb) => ({
    id: `playbook:${pb.id}`,
    kind: "workflow",
    origin: "builtin",
    label: pb.title,
    description: pb.guidance,
    icon: ScrollText,
    places: ["chat"],
    playbookId: pb.id,
    trigger: pb.trigger,
  }));

  const recipeSkills: Skill[] = recipes.map((recipe) => ({
    id: `recipe:${recipe.id}`,
    kind: "workflow",
    origin: recipe.is_builtin ? "builtin" : "mine",
    label: recipe.title,
    description: recipe.description ?? recipe.steps.map((step) => step.stepLabel).join(" ← "),
    icon: Layers,
    places: ["editor"],
    recipe,
  }));

  return [guided, ...builtinEdits, ...mine, ...prompts, ...workflows, ...recipeSkills];
}

/** The skills a `/` menu offers: runnable in that place and not hidden. */
export function skillsFor(skills: readonly Skill[], place: SkillPlace, isHidden: (id: string) => boolean): Skill[] {
  return skills.filter((s) => s.places.includes(place) && !isHidden(s.id));
}

/** Case- and harakat-insensitive match on the label, `/trigger` and id. */
export function matchesSkill(skill: Skill, query: string, normalize: (s: string) => string = (s) => s): boolean {
  const q = normalize(query.trim().toLowerCase());
  if (!q) return true;
  return [skill.label, skill.trigger ?? "", skill.id].some((field) => normalize(field.toLowerCase()).includes(q));
}
