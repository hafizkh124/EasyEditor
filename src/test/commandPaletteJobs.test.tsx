import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

/**
 * SYSTEM-2026 §5 — Ctrl+K extracts text into the open document, and opens
 * the jobs (audio/image to text, translation) for a new result that belongs
 * to the open document's folder. The "+" menu does the same.
 */

vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string, fallback?: string) => fallback ?? key, language: "ur", setLanguage: vi.fn() }),
}));
vi.mock("@/core/workspace/useAllDocuments", () => ({
  useAllDocuments: () => ({
    projects: [],
    docsMap: {},
    allDocs: [{ id: "d1", project_id: "folder-7", title: "فتاویٰ", updated_at: "" }],
    refresh: vi.fn(),
  }),
}));
vi.mock("@/lib/tasks/customTasks", async (orig) => ({
  ...(await orig<typeof import("@/lib/tasks/customTasks")>()),
  customTaskService: { list: vi.fn(async () => []) },
}));

const ws = {
  commandPaletteOpen: true,
  activeDocumentId: "d1" as string | null,
  setCommandPaletteOpen: vi.fn(),
  setActiveDocumentId: vi.fn(),
  toggleWorkbench: vi.fn(),
  stageCollapsed: false,
  setStageCollapsed: vi.fn(),
  setWorkbenchTab: vi.fn(),
  openRailPanel: vi.fn(),
  setWorkbenchOpen: vi.fn(),
  runEditorTask: null,
  runDocumentTask: null,
  requestSkillPrompt: vi.fn(),
  sendSelectionToWorkbench: vi.fn(),
  extractIntoEditor: vi.fn() as (() => void) | null,
};
vi.mock("@/core/workspace/WorkspaceContext", () => ({
  useWorkspace: () => ws,
  useOptionalWorkspace: () => ws,
}));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= function () {};

import { CommandPalette } from "@/components/workspace/CommandPalette";
import { useCreateActions } from "@/components/layout/useCreateActions";

let landed: { pathname: string; state: unknown } | null = null;
function Probe() {
  const loc = useLocation();
  landed = { pathname: loc.pathname, state: loc.state };
  return null;
}
const routes = (start: string, ui: React.ReactNode) =>
  render(
    <MemoryRouter initialEntries={[start]}>
      <Routes>
        <Route path="/workspace/d1" element={ui} />
        <Route path="/files" element={ui} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );

function CreateButtons() {
  return (
    <>
      {useCreateActions().map((a) => (
        <button key={a.id} onClick={a.run}>{a.label}</button>
      ))}
    </>
  );
}

describe("Ctrl+K jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    landed = null;
    ws.extractIntoEditor = vi.fn();
  });

  it("extracts into the open document", () => {
    routes("/workspace/d1", <CommandPalette />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "متن نکالیں" } });
    fireEvent.click(screen.getByText("متن نکالیں — اسی دستاویز میں"));
    expect(ws.extractIntoEditor).toHaveBeenCalled();
  });

  it("has no 'into this document' item without an open editor", () => {
    ws.extractIntoEditor = null;
    routes("/workspace/d1", <CommandPalette />);
    expect(screen.queryByText("متن نکالیں — اسی دستاویز میں")).not.toBeInTheDocument();
  });

  it("opens a job for the open document's folder", () => {
    routes("/workspace/d1", <CommandPalette />);
    fireEvent.click(screen.getByText("آڈیو سے متن"));
    expect(landed).toEqual({ pathname: "/transcribe", state: { projectId: "folder-7" } });
  });
});

describe("+ menu", () => {
  beforeEach(() => {
    landed = null;
  });

  it("starts a job in the folder open in Files", () => {
    ws.activeDocumentId = null;
    routes("/files?folder=f2", <CreateButtons />);
    fireEvent.click(screen.getByText("تصویر/PDF سے متن"));
    expect(landed).toEqual({ pathname: "/ocr", state: { projectId: "f2" } });
  });

  it("puts a new document in the open document's folder", () => {
    ws.activeDocumentId = "d1";
    routes("/workspace/d1", <CreateButtons />);
    fireEvent.click(screen.getByText("نیا دستاویز"));
    expect(landed).toEqual({ pathname: "/workspace", state: { intent: "new-document", projectId: "folder-7" } });
  });
});
