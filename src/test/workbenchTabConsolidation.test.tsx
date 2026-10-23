import { describe, it, expect, vi } from "vitest";
import { useEffect } from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { WorkspaceProvider } from "@/core/workspace/WorkspaceContext";
import { WorkbenchPanel } from "@/components/workspace/WorkbenchPanel";

// Radix's TabsTrigger selects on `mousedown`, not `click` (confirmed against
// @radix-ui/react-tabs's own source) — a plain `.click()`/`fireEvent.click`
// never fires it in jsdom, which doesn't synthesize the mousedown a real
// browser's click sequence would include.
function selectTab(el: HTMLElement) {
  act(() => { fireEvent.mouseDown(el); });
}

/**
 * M10 Phase 3 §3.6 — the Workbench went from 6 tabs to 4: AiReaderPanel +
 * NotesPanel merged into "Study" (StudyPanel.tsx), TasksTab + TrustTab
 * merged into "Trust" (TrustPanel.tsx), behind an inner segmented control
 * each. Real sub-panels are stubbed (their own behavior is covered
 * elsewhere, or not at all pre-existing — this file is about the tab
 * STRUCTURE: which outer tabs exist, and that switching the inner
 * segmented control keeps both sub-views mounted, the same "never unmount
 * a live SSE/draft" contract workbenchKeepMounted.test.tsx already pins for
 * the outer tabs).
 *
 * Down to 3 outer tabs since: Book Translation (/translate-book) absorbed
 * Quick Translate's text/image/PDF flows into one full-page destination, so
 * the "Translate" workbench tab was retired with nothing left to show.
 */

const mountCounts = { aiReader: 0, notes: 0, trust: 0 };

function makeStub(key: keyof typeof mountCounts, testId: string) {
  return function Stub() {
    useEffect(() => {
      mountCounts[key]++;
    }, []);
    return <div data-testid={testId} />;
  };
}

vi.mock("@/components/reader/AiReaderPanel", () => ({ AiReaderPanel: makeStub("aiReader", "aiReader-panel") }));
vi.mock("@/components/reader/NotesPanel", () => ({ NotesPanel: makeStub("notes", "notes-panel") }));
vi.mock("@/components/workspace/TrustTab", () => ({ TrustTab: makeStub("trust", "trust-panel") }));
vi.mock("@/components/research/ResearchPanel", () => ({ ResearchPanel: () => <div data-testid="research-panel" /> }));

function renderWorkbench() {
  return render(
    <MemoryRouter>
      <WorkspaceProvider>
        <WorkbenchPanel alwaysVisible />
      </WorkspaceProvider>
    </MemoryRouter>,
  );
}

describe("Workbench tab consolidation (M10 Phase 3 §3.6)", () => {
  it("shows exactly two outer tabs: Study and Research", () => {
    renderWorkbench();
    expect(screen.getByTitle("Study")).toBeInTheDocument();
    expect(screen.getByTitle("Research")).toBeInTheDocument();
    // The AI-activity record moved to the top bar (AiActivitySheet), not a tab.
    expect(screen.queryByTitle("AI activity")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Audit")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Translate")).not.toBeInTheDocument();
    // The retired standalone tabs no longer exist at the outer level.
    expect(screen.queryByTitle("AI Reader")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Notes")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Tasks")).not.toBeInTheDocument();
  });

  it("Study opens on AI Reader and offers an inner switch to Notes, keeping both mounted", () => {
    mountCounts.aiReader = 0;
    mountCounts.notes = 0;
    renderWorkbench();

    selectTab(screen.getByTitle("Study"));
    expect(screen.getByTestId("aiReader-panel")).toBeInTheDocument();
    expect(screen.getByTestId("notes-panel")).toBeInTheDocument();
    expect(screen.getByTestId("notes-panel").parentElement).toHaveClass("hidden");

    selectTab(screen.getByText("Notes"));
    expect(screen.getByTestId("aiReader-panel").parentElement).toHaveClass("hidden");
    expect(screen.getByTestId("notes-panel").parentElement).not.toHaveClass("hidden");
    // Switching the inner sub-view never remounted either stub.
    expect(mountCounts.aiReader).toBe(1);
    expect(mountCounts.notes).toBe(1);
  });
});
