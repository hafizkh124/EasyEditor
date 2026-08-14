import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkspaceProvider, useWorkspace } from "@/core/workspace/WorkspaceContext";
import { isWorkbenchTab } from "@/core/workspace/usePanelState";

/**
 * UX-v1 P3 — /translate and /extract were retired as standalone pages and now
 * redirect into `/workspace?panel=translate` / `?panel=extract`, the same
 * pattern /research already used. That only works if the workbench actually
 * opens on the requested tab rather than whatever tab localStorage last
 * remembered — this pins that contract down, generalized past the single
 * "research" case Workspace.tsx used to hardcode.
 */

function Probe() {
  const { workbenchCollapsed, workbenchTab } = useWorkspace();
  return (
    <div data-testid="probe" data-collapsed={workbenchCollapsed} data-tab={workbenchTab} />
  );
}

describe("isWorkbenchTab", () => {
  it("accepts every real workbench tab", () => {
    for (const tab of ["aiReader", "research", "translate", "extract", "notes", "tasks", "trust"]) {
      expect(isWorkbenchTab(tab)).toBe(true);
    }
  });

  it("rejects an unknown ?panel= value instead of silently opening something", () => {
    expect(isWorkbenchTab("nonsense")).toBe(false);
    expect(isWorkbenchTab(null)).toBe(false);
    expect(isWorkbenchTab(undefined)).toBe(false);
  });
});

describe("WorkspaceProvider — opening on a specific tab from the URL", () => {
  beforeEach(() => localStorage.clear());

  it("opens the workbench on the requested tab, e.g. from /workspace?panel=translate", () => {
    render(
      <WorkspaceProvider initialWorkbenchTab="translate">
        <Probe />
      </WorkspaceProvider>,
    );
    const probe = screen.getByTestId("probe");
    expect(probe.dataset.collapsed).toBe("false");
    expect(probe.dataset.tab).toBe("translate");
  });

  it("opens on extract too — not just the one tab Workspace.tsx used to special-case", () => {
    render(
      <WorkspaceProvider initialWorkbenchTab="extract">
        <Probe />
      </WorkspaceProvider>,
    );
    expect(screen.getByTestId("probe").dataset.tab).toBe("extract");
  });

  it("overrides whichever tab was last left open in localStorage", () => {
    localStorage.setItem("workspace.panels", JSON.stringify({ workbenchTab: "notes", workbenchCollapsed: true }));
    render(
      <WorkspaceProvider initialWorkbenchTab="extract">
        <Probe />
      </WorkspaceProvider>,
    );
    expect(screen.getByTestId("probe").dataset.tab).toBe("extract");
  });
});
