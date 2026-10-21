import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * SYSTEM-2026 §7 — Ctrl+K is the third place skills run from (after the two
 * `/` menus). Editor skills run on the open editor; chat skills go to the
 * research chat; a skill whose place is not open is absent.
 */

vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string, fallback?: string) => fallback ?? key, language: "ur", setLanguage: vi.fn() }),
}));
vi.mock("@/core/workspace/useAllDocuments", () => ({
  useAllDocuments: () => ({ projects: [], docsMap: {}, allDocs: [], refresh: vi.fn() }),
}));
vi.mock("@/lib/tasks/customTasks", async (orig) => ({
  ...(await orig<typeof import("@/lib/tasks/customTasks")>()),
  customTaskService: { list: vi.fn(async () => []) },
}));

const ws = {
  commandPaletteOpen: true,
  setCommandPaletteOpen: vi.fn(),
  setActiveDocumentId: vi.fn(),
  toggleWorkbench: vi.fn(),
  stageCollapsed: false,
  setStageCollapsed: vi.fn(),
  setWorkbenchTab: vi.fn(),
  openRailPanel: vi.fn(),
  setWorkbenchOpen: vi.fn(),
  runEditorTask: vi.fn() as ((slug: string) => void) | null,
  runDocumentTask: null,
  requestSkillPrompt: vi.fn(),
  sendSelectionToWorkbench: vi.fn(),
};
vi.mock("@/core/workspace/WorkspaceContext", () => ({
  useWorkspace: () => ws,
  useOptionalWorkspace: () => ws,
}));

// cmdk measures its list; jsdom has neither of these.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= function () {};

import { CommandPalette } from "@/components/workspace/CommandPalette";
import { resetSkillsStore } from "@/lib/skills/useSkills";

const renderPalette = () =>
  render(
    <MemoryRouter>
      <CommandPalette />
    </MemoryRouter>,
  );

describe("Ctrl+K skills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSkillsStore();
    ws.runEditorTask = vi.fn();
  });

  it("runs an editor skill on the open editor", () => {
    renderPalette();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "حرکات لگائیں" } });
    fireEvent.click(screen.getByText("حرکات لگائیں (تشکیل)"));
    expect(ws.runEditorTask).toHaveBeenCalledWith("add_harakat");
  });

  it("sends 'مجھ سے پوچھو' to the research chat", () => {
    renderPalette();
    fireEvent.click(screen.getByText("مجھ سے پوچھو"));
    expect(ws.setWorkbenchOpen).toHaveBeenCalledWith(true);
    expect(ws.requestSkillPrompt).toHaveBeenCalledWith(expect.objectContaining({ id: "grill_me" }));
  });

  it("leaves editor skills out when no editor is open", () => {
    ws.runEditorTask = null;
    renderPalette();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "حرکات لگائیں" } });
    expect(screen.queryByText("حرکات لگائیں (تشکیل)")).not.toBeInTheDocument();
  });
});
