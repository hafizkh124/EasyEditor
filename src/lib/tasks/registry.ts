import { stripHarakat } from "@/utils/arabicUtils";
import type { TaskDefinition } from "./types";

export const BUILTIN_TASKS: TaskDefinition[] = [
  {
    slug: "add_harakat",
    labelKey: "tasks.add_harakat",
    defaultLabel: "حرکات لگائیں (تشکیل)",
    engine: "refine-text",
    actionName: "add_harakat",
    scope: "selection",
    applyMode: "inline",
    outputFormat: "text",
    chunkable: true,
    producesSources: false,
    costModel: { baseTokens: 5, perKChars: 5 },
    surfaces: ["bubble", "slash", "library", "toolbar"],
  },
  {
    slug: "remove_harakat",
    labelKey: "tasks.remove_harakat",
    defaultLabel: "حرکات ہٹائیں",
    engine: "client",
    scope: "selection",
    applyMode: "inline",
    outputFormat: "text",
    chunkable: false,
    producesSources: false,
    costModel: { baseTokens: 0 },
    surfaces: ["bubble", "slash", "library", "toolbar"],
    clientFn: (text: string) => stripHarakat(text),
  },
  {
    slug: "spelling_check",
    labelKey: "tasks.spelling_check",
    defaultLabel: "املا کی درستی",
    engine: "refine-text",
    actionName: "spelling_check",
    scope: "selection",
    applyMode: "inline",
    outputFormat: "text",
    chunkable: true,
    producesSources: false,
    costModel: { baseTokens: 5, perKChars: 5 },
    surfaces: ["bubble", "slash", "library", "toolbar"],
  },
  {
    slug: "paraphrase",
    labelKey: "tasks.paraphrase",
    defaultLabel: "تفہیم / دہرائی (Paraphrase)",
    engine: "refine-text",
    actionName: "paraphrase",
    scope: "selection",
    applyMode: "inline",
    outputFormat: "text",
    chunkable: true,
    producesSources: false,
    costModel: { baseTokens: 5, perKChars: 5 },
    surfaces: ["bubble", "slash", "library", "toolbar"],
  },
  {
    slug: "summarize",
    labelKey: "tasks.summarize",
    defaultLabel: "خلاصہ بنائیں",
    engine: "refine-text",
    actionName: "summarize",
    scope: "selection",
    applyMode: "block",
    outputFormat: "text",
    chunkable: false, // Per SPEC-M3 §9 assumption 1
    producesSources: false,
    costModel: { baseTokens: 5, perKChars: 5 },
    surfaces: ["bubble", "slash", "library", "toolbar"],
  },
  {
    slug: "summarize_sections",
    labelKey: "tasks.summarize_sections",
    defaultLabel: "ابواب و عناوین کا خلاصہ (Summarize Sections)",
    engine: "refine-text",
    actionName: "summarize_sections",
    scope: "document",
    applyMode: "append",
    outputFormat: "text",
    chunkable: true,
    producesSources: false,
    costModel: { baseTokens: 5, perKChars: 5 },
    surfaces: ["bubble", "slash", "library", "toolbar"],
  },
  {
    slug: "citations",
    labelKey: "tasks.citations",
    defaultLabel: "علمی حوالہ جات تلاش کریں",
    engine: "refine-text",
    actionName: "citations",
    scope: "either",
    applyMode: "append",
    outputFormat: "text",
    chunkable: true,
    producesSources: true,
    costModel: { baseTokens: 5, perKChars: 5 },
    surfaces: ["bubble", "slash", "library", "toolbar"],
  },
  {
    slug: "auto_format",
    labelKey: "tasks.auto_format",
    defaultLabel: "خودکار فارمیٹنگ (Auto Format)",
    engine: "refine-text",
    actionName: "auto_format",
    scope: "document",
    applyMode: "replace_document",
    outputFormat: "html",
    chunkable: true,
    producesSources: false,
    costModel: { baseTokens: 5, perKChars: 5 },
    surfaces: ["slash", "library", "toolbar"], // NO "bubble" surface per FR-2.3
  },
  {
    slug: "normalize_script",
    labelKey: "tasks.normalize_script",
    defaultLabel: "رسم الخط کی یکسانیت (Normalize Script)",
    engine: "refine-text",
    actionName: "normalize_script",
    scope: "selection",
    applyMode: "inline",
    outputFormat: "text",
    chunkable: true,
    producesSources: false,
    costModel: { baseTokens: 5, perKChars: 5 },
    surfaces: ["bubble", "slash", "library", "toolbar"],
  },
  {
    slug: "formalize",
    labelKey: "tasks.formalize",
    defaultLabel: "علمی و رسمی اسلوب (Formalize)",
    engine: "refine-text",
    actionName: "formalize",
    scope: "selection",
    applyMode: "inline",
    outputFormat: "text",
    chunkable: true,
    producesSources: false,
    costModel: { baseTokens: 5, perKChars: 5 },
    surfaces: ["bubble", "slash", "library", "toolbar"],
  },
  {
    slug: "humanize",
    labelKey: "tasks.humanize",
    defaultLabel: "روان و سلیس انداز (Humanize)",
    engine: "refine-text",
    actionName: "humanize",
    scope: "selection",
    applyMode: "inline",
    outputFormat: "text",
    chunkable: true,
    producesSources: false,
    costModel: { baseTokens: 5, perKChars: 5 },
    surfaces: ["bubble", "slash", "library", "toolbar"],
  },
  {
    slug: "shorten",
    labelKey: "tasks.shorten",
    defaultLabel: "مختصر کریں (Shorten)",
    engine: "refine-text",
    actionName: "shorten",
    scope: "selection",
    applyMode: "inline",
    outputFormat: "text",
    chunkable: true,
    producesSources: false,
    costModel: { baseTokens: 5, perKChars: 5 },
    surfaces: ["bubble", "slash", "library", "toolbar"],
  },
];

/** Map of built-in tasks keyed by slug for instant sync lookups */
export const TASK_REGISTRY = new Map<string, TaskDefinition>(
  BUILTIN_TASKS.map((t) => [t.slug, t]),
);

/**
 * Custom tasks loaded from `ai_tasks`, merged in at runtime.
 *
 * Kept in a module-level map rather than React state because the slash menu
 * filters on every keystroke and the bubble menu renders on selection — both
 * need a synchronous lookup, and neither can await a query.
 */
const CUSTOM_TASKS = new Map<string, TaskDefinition>();

/** Replace the custom-task set (called after loading or editing `ai_tasks`). */
export function setCustomTasks(tasks: TaskDefinition[]): void {
  CUSTOM_TASKS.clear();
  for (const task of tasks) CUSTOM_TASKS.set(task.slug, task);
}

export function getTaskBySlug(slug: string): TaskDefinition | undefined {
  return TASK_REGISTRY.get(slug) ?? CUSTOM_TASKS.get(slug);
}

export function listAllTasks(): TaskDefinition[] {
  return [...BUILTIN_TASKS, ...CUSTOM_TASKS.values()];
}

export function getTasksForSurface(surface: "bubble" | "slash" | "library" | "toolbar"): TaskDefinition[] {
  return listAllTasks().filter((t) => t.surfaces.includes(surface));
}
