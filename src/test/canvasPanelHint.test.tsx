import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { WorkspaceProvider } from "@/core/workspace/WorkspaceContext";
import { CanvasPanel } from "@/components/workspace/CanvasPanel";
import { hasSeenWorkspaceHint } from "@/lib/onboarding";

// A real TipTap/ProseMirror instance is irrelevant to onboarding persistence
// and heavy to mount in jsdom; this test only needs the `doc` branch to
// render at all.
vi.mock("@/components/editor/RichEditor", () => ({
  default: () => <div data-testid="rich-editor-stub" />,
}));

/**
 * UX-v1 P6 — the 2-step first-run hint on the empty Canvas. Must behave like
 * a hint, not a tour: shown once for a genuinely new user, gone for good once
 * dismissed or once any document is opened — never reappearing to a user who
 * already found their way in.
 */

function renderCanvas(doc: null | { id: string } = null) {
  return render(
    <MemoryRouter>
      <WorkspaceProvider>
        <CanvasPanel
          doc={doc as any}
          docLoading={false}
          contentRevision={0}
          restoredContent={null}
        />
      </WorkspaceProvider>
    </MemoryRouter>,
  );
}

describe("CanvasPanel first-run hint", () => {
  beforeEach(() => localStorage.clear());

  it("shows the 2-step hint for a brand-new user with no document open", () => {
    renderCanvas(null);
    expect(screen.getByText("Create a new project in the Library")).toBeInTheDocument();
    expect(screen.getByText("Start writing here — research stays alongside")).toBeInTheDocument();
  });

  it("dismisses and persists when the close button is clicked", () => {
    renderCanvas(null);
    fireEvent.click(screen.getByLabelText("Dismiss"));

    expect(screen.queryByText("Create a new project in the Library")).not.toBeInTheDocument();
    expect(hasSeenWorkspaceHint()).toBe(true);
  });

  it("does not show again once already dismissed in a prior session", () => {
    localStorage.setItem("easyeditor-workspace-hint-dismissed", "1");
    renderCanvas(null);
    expect(screen.queryByText("Create a new project in the Library")).not.toBeInTheDocument();
    // The plain, steady-state empty message is still there for everyone.
    expect(screen.getByText("Select a book from the Library to start reading")).toBeInTheDocument();
  });

  it("persists dismissal once a document is opened, even without clicking the close button", () => {
    renderCanvas({ id: "doc-1" } as any);
    expect(hasSeenWorkspaceHint()).toBe(true);
  });
});
