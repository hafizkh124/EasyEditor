import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

/**
 * Research / OCR / Transcribe / Extract / Translate all hand a finished result
 * to the editor as router state. When the editor became the workspace, the new
 * `/workspace` page never read that state — it resolved a *blank* document
 * instead — so every one of those handoffs silently dropped the user's content.
 *
 * These tests pin down the contract that broke: content handed over must land
 * in a real document, and the handoff must not be routed through the old
 * `/editor` redirect.
 */

const createDocument = vi.fn();
const findBlankDocument = vi.fn();

vi.mock("@/core/workspace/documentService", () => ({
  documentService: {
    listProjects: () => Promise.resolve([{ id: "proj-1", title: "P", kind: "general" }]),
    createProject: () => Promise.resolve({ id: "proj-1", title: "P", kind: "general" }),
    createDocument: (...args: unknown[]) => createDocument(...args),
    findBlankDocument: (...args: unknown[]) => findBlankDocument(...args),
  },
}));

// The real shell pulls in the whole editor; this suite is about routing only.
vi.mock("@/components/workspace/WorkspaceLayout", () => ({
  WorkspaceLayout: () => <div data-testid="workspace-layout" />,
}));
vi.mock("@/core/workspace/WorkspaceContext", () => ({
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/useSeo", () => ({ useSeo: () => {} }));
vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (k: string) => k, direction: "rtl" }),
}));

import WorkspacePage from "@/pages/Workspace";
import { editorRoute } from "@/lib/routes";

function renderAt(state: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/workspace", state }]}>
      <Routes>
        <Route path="/workspace" element={<WorkspacePage />} />
        <Route path="/workspace/:documentId" element={<WorkspacePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("editor handoff", () => {
  beforeEach(() => {
    createDocument.mockReset();
    findBlankDocument.mockReset();
    createDocument.mockResolvedValue({ id: "doc-new" });
    findBlankDocument.mockResolvedValue(null);
  });

  it("creates a document containing the content handed over", async () => {
    renderAt({ content: "<p>transcribed text</p>", source: "transcribe" });

    await waitFor(() => expect(createDocument).toHaveBeenCalled());

    const [projectId, title, content] = createDocument.mock.calls[0];
    expect(projectId).toBe("proj-1");
    // Titled after where it came from, not left as "Untitled".
    expect(title).toBe("editor.from_transcribe");
    // The handed-over text must actually be in the new document.
    expect(JSON.stringify(content)).toContain("transcribed text");
  });

  it("never reuses a blank document when content was handed over", async () => {
    renderAt({ content: "<p>ocr output</p>", source: "ocr" });

    await waitFor(() => expect(createDocument).toHaveBeenCalled());
    // Reusing a blank document here is exactly how the content got lost.
    expect(findBlankDocument).not.toHaveBeenCalled();
  });

  it("still reuses a blank document when nothing was handed over", async () => {
    findBlankDocument.mockResolvedValue({ id: "doc-blank" });
    renderAt(undefined);

    await waitFor(() => expect(findBlankDocument).toHaveBeenCalled());
    expect(createDocument).not.toHaveBeenCalled();
  });

  it("routes handoffs to the workspace, not the retired /editor redirect", () => {
    // Call sites must not hardcode /editor: that path only survives as a
    // redirect for VITE_WORKSPACE_SHELL=false.
    expect(editorRoute()).toBe("/workspace");
    expect(editorRoute("abc")).toBe("/workspace/abc");
  });
});
