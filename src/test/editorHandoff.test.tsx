import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

/**
 * Research / OCR / Transcribe / Translate all hand a finished result
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
  useOptionalWorkspace: () => null,
}));
vi.mock("@/core/workspace/AgentRunContext", () => ({
  AgentRunProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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
    // Named after what it says, not "Untitled" and not the source label — a
    // workspace of identical "From Transcribe" documents cannot be navigated.
    expect(title).toBe("transcribed text");
    // The handed-over text must actually be in the new document.
    expect(JSON.stringify(content)).toContain("transcribed text");
  });

  it("falls back to the source label when the content has no usable first line", async () => {
    renderAt({ content: "   \n\n  ", source: "transcribe" });

    await waitFor(() => expect(createDocument).toHaveBeenCalled());
    expect(createDocument.mock.calls[0][1]).toBe("editor.from_transcribe");
  });

  it("converts markdown handoffs instead of leaving the markers as text", async () => {
    renderAt({ content: "## عنوان\n\n**زور** دیا", source: "research" });

    await waitFor(() => expect(createDocument).toHaveBeenCalled());

    const [, title, content] = createDocument.mock.calls[0];
    const json = JSON.stringify(content);
    expect(title).toBe("عنوان");
    // The markers themselves must be gone, having become real nodes.
    expect(json).not.toContain("##");
    expect(json).not.toContain("**");
    expect(json).toContain("زور");
  });

  it("passes HTML handoffs through without escaping them", async () => {
    renderAt({ content: "<p>پہلے سے HTML</p>", source: "manual" });

    await waitFor(() => expect(createDocument).toHaveBeenCalled());
    // Some panels already send HTML; running markdown conversion over it
    // would escape the tags into visible &lt;p&gt; text.
    expect(JSON.stringify(createDocument.mock.calls[0][2])).not.toContain("&lt;p&gt;");
  });

  it("never reuses a blank document when content was handed over", async () => {
    renderAt({ content: "<p>ocr output</p>", source: "ocr" });

    await waitFor(() => expect(createDocument).toHaveBeenCalled());
    // Reusing a blank document here is exactly how the content got lost.
    expect(findBlankDocument).not.toHaveBeenCalled();
  });

  it("opens a fresh, empty, untitled document for the create menu's New document", async () => {
    renderAt({ intent: "new-document" });

    await waitFor(() => expect(createDocument).toHaveBeenCalledTimes(1));

    const [projectId, title, content] = createDocument.mock.calls[0];
    expect(projectId).toBe("proj-1");
    expect(title).toBe("editor.untitled");
    // Nothing was handed over, so nothing but an empty paragraph may land in it.
    expect(JSON.stringify(content)).not.toMatch(/"text":"[^"]+"/);
  });

  it("leaves the workspace on Home when nothing was handed over", async () => {
    findBlankDocument.mockResolvedValue({ id: "doc-blank" });
    renderAt(undefined);

    // SPEC-M6: a bare /workspace opens the Home screen for browsing instead of
    // silently auto-resolving (and leaving) a blank document. The blank-doc
    // reuse shortcut is gone by design — the user chooses what to open.
    await waitFor(() => expect(findBlankDocument).not.toHaveBeenCalled());
    expect(createDocument).not.toHaveBeenCalled();
  });

  it("routes handoffs to the workspace, not the retired /editor redirect", () => {
    // Call sites must not hardcode /editor: that path only survives as a
    // redirect for VITE_WORKSPACE_SHELL=false.
    expect(editorRoute()).toBe("/workspace");
    expect(editorRoute("abc")).toBe("/workspace/abc");
  });
});
