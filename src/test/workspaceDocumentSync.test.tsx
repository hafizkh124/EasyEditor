import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useNavigate, useParams } from "react-router-dom";
import { WorkspaceProvider, useWorkspace } from "@/core/workspace/WorkspaceContext";

/**
 * `/workspace` (no id) resolves a blank document and redirects to
 * `/workspace/:documentId`. Both paths render the same page component at the
 * same position in the tree, so React reuses the instance and the provider is
 * *not* remounted — which means reading the route param once, at mount, leaves
 * the workspace pointing at no document: nothing loads and nothing saves.
 *
 * The provider therefore has to follow the route, not merely start from it.
 */

function ActiveDocument() {
  const { activeDocumentId } = useWorkspace();
  const navigate = useNavigate();
  return (
    <>
      <span data-testid="active">{activeDocumentId ?? "none"}</span>
      <button onClick={() => navigate("/workspace/doc-1", { replace: true })}>resolve</button>
    </>
  );
}

/** Stands in for pages/Workspace.tsx: reads the param, feeds the provider. */
function WorkspacePage() {
  const { documentId } = useParams<{ documentId?: string }>();
  return (
    <WorkspaceProvider documentId={documentId}>
      <ActiveDocument />
    </WorkspaceProvider>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/workspace" element={<WorkspacePage />} />
        <Route path="/workspace/:documentId" element={<WorkspacePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("WorkspaceProvider — following the route", () => {
  it("starts on the document named in the URL", () => {
    renderAt("/workspace/doc-7");
    expect(screen.getByTestId("active").textContent).toBe("doc-7");
  });

  it("adopts the document after /workspace redirects to /workspace/:id", async () => {
    renderAt("/workspace");
    expect(screen.getByTestId("active").textContent).toBe("none");

    await act(async () => {
      screen.getByText("resolve").click();
    });

    expect(screen.getByTestId("active").textContent).toBe("doc-1");
  });
});
