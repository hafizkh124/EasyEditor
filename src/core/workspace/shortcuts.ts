/**
 * Plan §3.0 — the workspace keyboard map. Handled centrally by
 * `useWorkspaceShortcuts` (mounted in WorkspaceLayout) and listed in the
 * settings panel + command palette so they are discoverable.
 *
 * `keys` uses the platform-neutral "Mod" for Ctrl/Cmd; the handler resolves it.
 */
export interface WorkspaceShortcut {
  id: string;
  keys: string;
  labelKey: string;
  labelFallback: string;
  /** Which rail panel / action this maps to (consumed by the handler). */
  action:
    | { type: "rail"; panel: "files" | "library" | "history" }
    | { type: "toggle-side" }
    | { type: "toggle-workbench" }
    | { type: "toggle-stage" }
    | { type: "maximize-stage" }
    | { type: "focus-composer" };
}

export const WORKSPACE_SHORTCUTS: WorkspaceShortcut[] = [
  { id: "files", keys: "Ctrl+Shift+E", labelKey: "rail.files", labelFallback: "فائلیں", action: { type: "rail", panel: "files" } },
  { id: "library", keys: "Ctrl+Shift+B", labelKey: "rail.library", labelFallback: "مکتبہ", action: { type: "rail", panel: "library" } },
  { id: "history", keys: "Ctrl+Shift+H", labelKey: "rail.history", labelFallback: "تاریخ", action: { type: "rail", panel: "history" } },
  { id: "side", keys: "Ctrl+B", labelKey: "workspace.sc_toggle_side", labelFallback: "سائیڈ پینل", action: { type: "toggle-side" } },
  { id: "workbench", keys: "Ctrl+J", labelKey: "workspace.sc_toggle_workbench", labelFallback: "ورک بینچ", action: { type: "toggle-workbench" } },
  { id: "stage", keys: "Ctrl+Shift+A", labelKey: "workspace.sc_toggle_stage", labelFallback: "آرٹیفیکٹ اسٹیج", action: { type: "toggle-stage" } },
  { id: "stage-max", keys: "Ctrl+Shift+Enter", labelKey: "workspace.sc_maximize_stage", labelFallback: "اسٹیج فل اسکرین", action: { type: "maximize-stage" } },
  { id: "composer", keys: "Ctrl+L", labelKey: "workspace.sc_focus_composer", labelFallback: "کمپوزر پر فوکس", action: { type: "focus-composer" } },
];
