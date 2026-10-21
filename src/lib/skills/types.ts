import type { LucideIcon } from "lucide-react";
import type { ScholarlyPromptDef } from "@/lib/prompts/promptsRegistry";

/**
 * One skill (SYSTEM-2026 §7). What used to be four separate lists — AI tasks,
 * my prompts, playbooks and scholarly prompts — are all skills now, and every
 * `/` menu and the settings page read the same list.
 *
 * - `edit`: changes the selected text or the document (the AI tasks).
 * - `prompt`: fills a ready-made instruction into the chat.
 * - `guided`: an interview before writing ("مجھ سے پوچھو").
 * - `workflow`: several steps in a row (the agent's playbooks).
 */
export type SkillKind = "edit" | "prompt" | "guided" | "workflow";

/** Where a skill can run: the editor's `/`, the chat's `/`, or both. */
export type SkillPlace = "editor" | "chat";

export interface Skill {
  id: string;
  kind: SkillKind;
  origin: "builtin" | "mine";
  label: string;
  description?: string;
  icon?: LucideIcon;
  places: SkillPlace[];
  /** `edit`: the task registry slug the editor runs. */
  taskSlug?: string;
  /** `mine`: the instruction text, inserted into the chat. */
  promptText?: string;
  /** `prompt` / `guided`: the template whose arguments the scholar fills in. */
  prompt?: ScholarlyPromptDef;
  /** `workflow`: the playbook, and its `/trigger` if it has one. */
  playbookId?: string;
  trigger?: string;
  /** `mine`: the `ai_tasks` row, for editing and archiving in settings. */
  rowId?: string;
  baseTaskSlug?: string | null;
}
