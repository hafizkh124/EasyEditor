import { useEffect } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { WORKSPACE_SHORTCUTS } from "./shortcuts";

/**
 * Plan §3.0 — the workspace keyboard map. Mounted once in WorkspaceLayout.
 * Ignores keystrokes while a text field / contenteditable is focused so it
 * never eats typing in the editor or the composer (except Ctrl+L, which is
 * explicitly "focus the composer" and should work from anywhere).
 */
export function useWorkspaceShortcuts(): void {
  const ws = useWorkspace();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      const key = e.key === "Enter" ? "Enter" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
      const combo = [
        "Ctrl",
        e.shiftKey ? "Shift" : null,
        key,
      ].filter(Boolean).join("+");

      const match = WORKSPACE_SHORTCUTS.find((s) => s.keys === combo);
      if (!match) return;

      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (typing && match.action.type !== "focus-composer") return;

      e.preventDefault();
      switch (match.action.type) {
        case "rail":
          ws.toggleRailPanel(match.action.panel);
          break;
        case "toggle-side":
          ws.toggleRailPanel(ws.activeRailPanel ?? "library");
          break;
        case "toggle-workbench":
          ws.toggleWorkbench();
          break;
        case "toggle-stage":
          ws.setStageCollapsed(!ws.stageCollapsed);
          break;
        case "maximize-stage":
          ws.setStageMaximized(!ws.stageMaximized);
          break;
        case "focus-composer":
          document.querySelector<HTMLTextAreaElement>('[data-workspace-composer] textarea')?.focus();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ws]);
}
