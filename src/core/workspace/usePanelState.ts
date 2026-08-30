import { useState, useEffect, useCallback } from "react";

export type WorkbenchTab = "aiReader" | "research" | "translate" | "notes" | "tasks" | "trust" | "agent";

export const WORKBENCH_TABS: readonly WorkbenchTab[] =
  ["aiReader", "research", "translate", "notes", "tasks", "trust", "agent"];

export function isWorkbenchTab(value: unknown): value is WorkbenchTab {
  return typeof value === "string" && (WORKBENCH_TABS as readonly string[]).includes(value);
}

interface PanelState {
  libraryWidth: number;
  workbenchWidth: number;
  libraryCollapsed: boolean;
  workbenchCollapsed: boolean;
  workbenchTab: WorkbenchTab;
}

const STORAGE_KEY = "workspace.panels";

const DEFAULT_STATE: PanelState = {
  libraryWidth: 260,
  workbenchWidth: 360,
  libraryCollapsed: false,
  workbenchCollapsed: true, // Default closed per Constitution §1.3 (Workbench on Demand)
  workbenchTab: "research",
};

function loadStoredState(): PanelState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw);
    return {
      libraryWidth: typeof parsed.libraryWidth === "number" ? parsed.libraryWidth : DEFAULT_STATE.libraryWidth,
      workbenchWidth: typeof parsed.workbenchWidth === "number" ? parsed.workbenchWidth : DEFAULT_STATE.workbenchWidth,
      libraryCollapsed: Boolean(parsed.libraryCollapsed),
      workbenchCollapsed: Boolean(parsed.workbenchCollapsed),
      workbenchTab: isWorkbenchTab(parsed.workbenchTab) ? parsed.workbenchTab : DEFAULT_STATE.workbenchTab,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export function usePanelState(initialWorkbenchOpenFromUrl = false, initialWorkbenchTab?: WorkbenchTab) {
  const [state, setState] = useState<PanelState>(() => {
    const loaded = loadStoredState();
    // A specific tab (e.g. `?panel=translate`) implies opening the workbench
    // on it, regardless of whichever tab localStorage last remembered.
    if (initialWorkbenchTab) {
      return { ...loaded, workbenchCollapsed: false, workbenchTab: initialWorkbenchTab };
    }
    if (initialWorkbenchOpenFromUrl) {
      return { ...loaded, workbenchCollapsed: false };
    }
    return loaded;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore storage errors */
    }
  }, [state]);

  const toggleLibrary = useCallback(() => {
    setState((prev) => ({ ...prev, libraryCollapsed: !prev.libraryCollapsed }));
  }, []);

  const toggleWorkbench = useCallback(() => {
    setState((prev) => ({ ...prev, workbenchCollapsed: !prev.workbenchCollapsed }));
  }, []);

  const setWorkbenchOpen = useCallback((open: boolean) => {
    setState((prev) => ({ ...prev, workbenchCollapsed: !open }));
  }, []);

  const setWorkbenchTab = useCallback((tab: WorkbenchTab) => {
    setState((prev) => ({ ...prev, workbenchTab: tab, workbenchCollapsed: false }));
  }, []);

  return {
    libraryWidth: state.libraryWidth,
    workbenchWidth: state.workbenchWidth,
    libraryCollapsed: state.libraryCollapsed,
    workbenchCollapsed: state.workbenchCollapsed,
    workbenchTab: state.workbenchTab,
    toggleLibrary,
    toggleWorkbench,
    setWorkbenchOpen,
    setWorkbenchTab,
  };
}
