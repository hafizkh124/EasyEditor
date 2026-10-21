import { useState, useEffect, useCallback } from "react";

// M10 Phase 3 §3.6 — "aiReader"+"notes" merged into "study" (StudyPanel.tsx),
// "tasks"+"trust" merged into "trust" (TrustPanel.tsx); "agent" was already
// dead since Phase 1.2 removed the standalone Agent tab (ResearchPanel now
// decides internally whether to show the agent composer). "translate" was
// retired the same way: Book Translation (/translate-book) absorbed Quick
// Translate's text/image/PDF flows into one full-page destination, so the
// narrow-sidebar tab has nothing left to show. A stale persisted value from
// any of the retired names falls through loadStoredState's isWorkbenchTab
// check below to DEFAULT_STATE — a one-time reset to Research, not a crash.
export type WorkbenchTab = "study" | "research" | "trust";

export const WORKBENCH_TABS: readonly WorkbenchTab[] =
  ["study", "research", "trust"];

export function isWorkbenchTab(value: unknown): value is WorkbenchTab {
  return typeof value === "string" && (WORKBENCH_TABS as readonly string[]).includes(value);
}

// Plan §3.1 — the start-edge activity rail. JKHSSN is a tab inside "library"
// (مکتبہ), not its own rail icon (§3.0). `null` = the side panel is collapsed
// to just the 48px rail.
// "folder" is the folder index (SYSTEM-2026 §3), first and the default.
export type RailPanel = "folder" | "files" | "library" | "history" | "settings";

const RAIL_PANELS: readonly RailPanel[] = ["folder", "files", "library", "history", "settings"];

export function isRailPanel(value: unknown): value is RailPanel {
  return typeof value === "string" && (RAIL_PANELS as readonly string[]).includes(value);
}

interface PanelState {
  activeRailPanel: RailPanel | null;
  workbenchCollapsed: boolean;
  workbenchTab: WorkbenchTab;
  /** Plan §5.2 — the artifact stage (a vertical split of the Canvas zone). */
  stageCollapsed: boolean;
  stageMaximized: boolean;
}

const STORAGE_KEY = "workspace.panels";

const DEFAULT_STATE: PanelState = {
  activeRailPanel: "folder",
  workbenchCollapsed: true, // Default closed per Constitution §1.3 (Workbench on Demand)
  workbenchTab: "research",
  stageCollapsed: false,
  stageMaximized: false,
};

function loadStoredState(): PanelState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw);
    return {
      // Migration: pre-rail state used `libraryCollapsed: boolean`. Honour it
      // (collapsed → null), otherwise take the new `activeRailPanel`.
      activeRailPanel: isRailPanel(parsed.activeRailPanel)
        ? parsed.activeRailPanel
        : parsed.libraryCollapsed === true
          ? null
          : DEFAULT_STATE.activeRailPanel,
      workbenchCollapsed: Boolean(parsed.workbenchCollapsed ?? DEFAULT_STATE.workbenchCollapsed),
      workbenchTab: isWorkbenchTab(parsed.workbenchTab) ? parsed.workbenchTab : DEFAULT_STATE.workbenchTab,
      stageCollapsed: Boolean(parsed.stageCollapsed),
      stageMaximized: Boolean(parsed.stageMaximized),
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export function usePanelState(initialWorkbenchOpenFromUrl = false, initialWorkbenchTab?: WorkbenchTab) {
  const [state, setState] = useState<PanelState>(() => {
    const loaded = loadStoredState();
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

  const setActiveRailPanel = useCallback((panel: RailPanel | null) => {
    setState((prev) => ({ ...prev, activeRailPanel: panel }));
  }, []);

  const toggleRailPanel = useCallback((panel: RailPanel) => {
    setState((prev) => ({ ...prev, activeRailPanel: prev.activeRailPanel === panel ? null : panel }));
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

  const setStageCollapsed = useCallback((collapsed: boolean) => {
    setState((prev) => ({ ...prev, stageCollapsed: collapsed, stageMaximized: collapsed ? false : prev.stageMaximized }));
  }, []);

  const setStageMaximized = useCallback((maximized: boolean) => {
    setState((prev) => ({ ...prev, stageMaximized: maximized, stageCollapsed: maximized ? false : prev.stageCollapsed }));
  }, []);

  // Back-compat aliases while callers migrate off the "library" naming.
  const libraryCollapsed = state.activeRailPanel === null;
  const toggleLibrary = useCallback(() => {
    setState((prev) => ({ ...prev, activeRailPanel: prev.activeRailPanel === null ? "library" : null }));
  }, []);

  return {
    activeRailPanel: state.activeRailPanel,
    setActiveRailPanel,
    toggleRailPanel,
    libraryCollapsed,
    toggleLibrary,
    workbenchCollapsed: state.workbenchCollapsed,
    toggleWorkbench,
    setWorkbenchOpen,
    workbenchTab: state.workbenchTab,
    setWorkbenchTab,
    stageCollapsed: state.stageCollapsed,
    setStageCollapsed,
    stageMaximized: state.stageMaximized,
    setStageMaximized,
  };
}
