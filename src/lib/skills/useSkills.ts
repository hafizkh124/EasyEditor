import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { BUILTIN_TASKS, setCustomTasks } from "@/lib/tasks/registry";
import { customTaskService, rowToDefinition, type CustomTaskRow } from "@/lib/tasks/customTasks";
import { SCHOLARLY_PROMPTS } from "@/lib/prompts/promptsRegistry";
import { PLAYBOOKS } from "~shared/playbooks/registry";
import { recipeService, type Recipe } from "@/lib/recipes/recipeService";
import { validateRecipe } from "@/lib/recipes/recipeOrchestrator";
import { isDesktop } from "@/utils/environment";
import { logger } from "@/lib/logger";
import { buildSkills, skillsFor } from "./registry";
import type { Skill, SkillPlace } from "./types";

const log = logger.child("skills");

/**
 * The skills list as React state. One shared store, so the editor's `/`, the
 * chat's `/` and Settings → Skills always agree, and a skill hidden or created
 * in one place shows up everywhere at once.
 *
 * Hiding:
 * - a playbook is switched off in the desktop skills store, which is what the
 *   agent itself reads — off means off for its keyword matching too;
 * - anything else is remembered on this device.
 *
 * Loading my skills here also registers them with the task registry, which
 * used to happen only when the old Tasks tab had been opened.
 */

const HIDDEN_KEY = "easyeditor.skills.hidden";

interface State {
  customRows: CustomTaskRow[];
  recipes: Recipe[];
  playbookEnabled: Record<string, boolean>;
  hidden: string[];
  loaded: boolean;
}

function readHidden(): string[] {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeHidden(hidden: string[]) {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden));
  } catch { /* storage unavailable: the choice lasts until reload */ }
}

let state: State = { customRows: [], recipes: [], playbookEnabled: {}, hidden: readHidden(), loaded: false };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setState(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

const skillsApi = () => (typeof window !== "undefined" ? window.electronAPI?.skills : undefined);
// Playbooks run on the desktop agent; the on/off switches need its skills store.
const playbooksAvailable = () => isDesktop();

async function load(): Promise<void> {
  // Each source lands on its own, so a slow one (recipes come from the
  // backend) never holds the others back.
  const mine = customTaskService
    .list()
    .catch((err: unknown) => {
      log.warn("loading my skills failed", { err });
      return [] as CustomTaskRow[];
    })
    .then((rows) => {
      const customRows = (rows ?? []).filter((r) => !r.archived_at);
      setCustomTasks(customRows.map(rowToDefinition));
      setState({ customRows, loaded: true });
    });

  const switches =
    playbooksAvailable() && skillsApi()?.list
      ? skillsApi()!
          .list()
          .then((r) => setState({ playbookEnabled: r.merged ?? {} }))
          .catch(() => undefined)
      : Promise.resolve();

  const recipes =
    import.meta.env.VITE_RECIPES === "false"
      ? Promise.resolve()
      : Promise.all([recipeService.listRecipes().catch(() => [] as Recipe[]), mine]).then(([list]) => {
          // Validated after my skills are registered, since a recipe can name
          // one. A recipe that would fail at some step is left out of the menus.
          setState({ recipes: (list ?? []).filter((r) => validateRecipe(r).ok) });
        });

  await Promise.all([mine, switches, recipes]);
}

/** Reload my skills and the playbook switches (after creating or editing one). */
export function refreshSkills(): Promise<void> {
  loading = load().finally(() => {
    loading = null;
  });
  return loading;
}

/** For tests: drop everything loaded so far. */
export function resetSkillsStore() {
  state = { customRows: [], recipes: [], playbookEnabled: {}, hidden: readHidden(), loaded: false };
  loading = null;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => state;

export function useSkills() {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    if (!s.loaded && !loading) void refreshSkills();
  }, [s.loaded]);

  const skills: Skill[] = useMemo(
    () =>
      buildSkills({
        tasks: BUILTIN_TASKS,
        customRows: s.customRows,
        scholarlyPrompts: SCHOLARLY_PROMPTS,
        playbooks: playbooksAvailable() ? PLAYBOOKS : null,
        recipes: s.recipes,
      }),
    [s.customRows, s.recipes],
  );

  const isHidden = useCallback(
    (id: string) =>
      id.startsWith("playbook:")
        ? s.playbookEnabled[id.slice("playbook:".length)] === false
        : s.hidden.includes(id),
    [s.playbookEnabled, s.hidden],
  );

  const setHidden = useCallback(async (id: string, hidden: boolean) => {
    if (id.startsWith("playbook:")) {
      const playbookId = id.slice("playbook:".length);
      setState({ playbookEnabled: { ...state.playbookEnabled, [playbookId]: !hidden } });
      try {
        await skillsApi()?.setEnabled(playbookId, !hidden, "global");
      } finally {
        void refreshSkills();
      }
      return;
    }
    const next = hidden ? Array.from(new Set([...state.hidden, id])) : state.hidden.filter((x) => x !== id);
    writeHidden(next);
    setState({ hidden: next });
  }, []);

  const forPlace = useCallback((place: SkillPlace) => skillsFor(skills, place, isHidden), [skills, isHidden]);

  return { skills, loaded: s.loaded, isHidden, setHidden, forPlace };
}
