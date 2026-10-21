import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { BUILTIN_TASKS, setCustomTasks } from "@/lib/tasks/registry";
import { customTaskService, rowToDefinition, type CustomTaskRow } from "@/lib/tasks/customTasks";
import { SCHOLARLY_PROMPTS } from "@/lib/prompts/promptsRegistry";
import { PLAYBOOKS } from "~shared/playbooks/registry";
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

let state: State = { customRows: [], playbookEnabled: {}, hidden: readHidden(), loaded: false };
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
  const [rows, merged] = await Promise.all([
    customTaskService.list().catch((err: unknown) => {
      log.warn("loading my skills failed", { err });
      return [] as CustomTaskRow[];
    }),
    playbooksAvailable() && skillsApi()?.list
      ? skillsApi()!.list().then((r) => r.merged).catch(() => ({} as Record<string, boolean>))
      : Promise.resolve({} as Record<string, boolean>),
  ]);
  const customRows = (rows ?? []).filter((r) => !r.archived_at);
  setCustomTasks(customRows.map(rowToDefinition));
  setState({ customRows, playbookEnabled: merged ?? {}, loaded: true });
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
  state = { customRows: [], playbookEnabled: {}, hidden: readHidden(), loaded: false };
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
      }),
    [s.customRows],
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
