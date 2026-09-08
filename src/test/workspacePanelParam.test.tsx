import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkspaceProvider, useWorkspace } from "@/core/workspace/WorkspaceContext";
import { isWorkbenchTab } from "@/core/workspace/usePanelState";

/**
 * UX-v1 P3 — /translate was retired as a standalone page and now
 * redirects into `/workspace?panel=translate`, the same
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
    // M10 Phase 3 §3.6 — "aiReader"/"notes" merged into "study", "tasks" folded
    // into "trust". A stale ?panel=notes (or similar) link is no longer a
    // known tab — see the "rejects a retired tab id" case below.
    for (const tab of ["study", "research", "translate", "trust"]) {
      expect(isWorkbenchTab(tab)).toBe(true);
    }
  });

  it("rejects a retired pre-Phase-3 tab id instead of silently opening something", () => {
    for (const retired of ["aiReader", "notes", "tasks", "agent"]) {
      expect(isWorkbenchTab(retired)).toBe(false);
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

  it("opens on study too — not just the one tab Workspace.tsx used to special-case", () => {
    render(
      <WorkspaceProvider initialWorkbenchTab="study">
        <Probe />
      </WorkspaceProvider>,
    );
    expect(screen.getByTestId("probe").dataset.tab).toBe("study");
  });

  it("overrides whichever tab was last left open in localStorage", () => {
    localStorage.setItem("workspace.panels", JSON.stringify({ workbenchTab: "study", workbenchCollapsed: true }));
    render(
      <WorkspaceProvider initialWorkbenchTab="study">
        <Probe />
      </WorkspaceProvider>,
    );
    expect(screen.getByTestId("probe").dataset.tab).toBe("study");
  });

  it("a stale pre-Phase-3 persisted tab (e.g. \"notes\") falls back to the default rather than crashing", () => {
    localStorage.setItem("workspace.panels", JSON.stringify({ workbenchTab: "notes", workbenchCollapsed: false }));
    render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    );
    expect(screen.getByTestId("probe").dataset.tab).toBe("research");
  });
});
