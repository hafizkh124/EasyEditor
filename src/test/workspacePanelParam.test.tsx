import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkspaceProvider, useWorkspace } from "@/core/workspace/WorkspaceContext";
import { isWorkbenchTab } from "@/core/workspace/usePanelState";

/**
 * UX-v1 P3 — /research was retired as a standalone page and redirects into
 * `/workspace?panel=research`. That only works if the workbench actually
 * opens on the requested tab rather than whatever tab localStorage last
 * remembered — this pins that contract down, generalized past the single
 * "research" case Workspace.tsx used to hardcode.
 *
 * /translate used the same `?panel=translate` pattern until Book Translation
 * absorbed the Workbench's Translate tab entirely — /translate now redirects
 * straight to /translate-book instead, so "translate" belongs in the
 * retired-tab-id list below alongside aiReader/notes/tasks/agent.
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
    for (const tab of ["study", "research", "trust"]) {
      expect(isWorkbenchTab(tab)).toBe(true);
    }
  });

  it("rejects a retired tab id instead of silently opening something", () => {
    // aiReader/notes/tasks/agent: pre-Phase-3. translate: retired once Book
    // Translation absorbed the Workbench's Translate tab (see file header).
    for (const retired of ["aiReader", "notes", "tasks", "agent", "translate"]) {
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

  it("opens the workbench on the requested tab, e.g. from /workspace?panel=trust", () => {
    render(
      <WorkspaceProvider initialWorkbenchTab="trust">
        <Probe />
      </WorkspaceProvider>,
    );
    const probe = screen.getByTestId("probe");
    expect(probe.dataset.collapsed).toBe("false");
    expect(probe.dataset.tab).toBe("trust");
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

describe("WorkspaceProvider — a question handed over from Home", () => {
  function QueryProbe() {
    const { pendingWorkbenchQuery } = useWorkspace();
    return <div data-testid="query">{pendingWorkbenchQuery ?? ""}</div>;
  }

  it("starts with the question pending, for the research composer to pre-fill", () => {
    render(
      <WorkspaceProvider initialWorkbenchTab="research" initialWorkbenchQuery="What is wudu?">
        <QueryProbe />
      </WorkspaceProvider>,
    );
    expect(screen.getByTestId("query")).toHaveTextContent("What is wudu?");
  });
});
