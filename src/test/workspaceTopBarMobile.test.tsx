import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Audit MB-01 / SYSTEM-2026 §3 — on a phone the workspace bar is two
 * clusters: the folder over the title (tap the folder for its files), and
 * the chat and "more". Back, the separate library button and the language
 * toggle are gone from the bar; language is in "more".
 */

const setLanguage = vi.fn();
vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (_k: string, f?: string) => f ?? _k, language: "ur", setLanguage, direction: "rtl" }),
}));
const setMobileLibraryOpen = vi.fn();
vi.mock("@/core/workspace/WorkspaceContext", () => ({
  useWorkspace: () => ({
    workbenchCollapsed: true, toggleWorkbench: vi.fn(), setCommandPaletteOpen: vi.fn(),
    mobileLibraryOpen: false, setMobileLibraryOpen,
  }),
}));
vi.mock("@/components/workspace/WorkspaceAppMenu", () => ({ WorkspaceAppMenu: () => <div data-testid="app-menu" /> }));
vi.mock("@/components/auth/DesktopAccountMenu", () => ({ DesktopAccountMenu: () => null }));

import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar";
import type { Document } from "@/core/workspace/types";

function renderBar() {
  render(
    <MemoryRouter>
      <WorkspaceTopBar
        doc={{ id: "d1", title: "سونے کا نصاب" } as unknown as Document}
        projectName="فتاویٰ زکوٰۃ"
        saveStatus="saved"
        versions={[]}
        currentText=""
        currentHtml=""
        onTitleChange={vi.fn()}
        onRestoreVersion={vi.fn()}
        onCreateSnapshot={vi.fn(async () => undefined)}
      />
    </MemoryRouter>,
  );
}

describe("WorkspaceTopBar on a phone", () => {
  it("opens the folder's files from the folder name over the title", () => {
    renderBar();
    const folder = screen.getByRole("button", { name: "فائلیں: فتاویٰ زکوٰۃ" });
    expect(folder).toHaveClass("md:hidden");
    fireEvent.click(folder);
    expect(setMobileLibraryOpen).toHaveBeenCalledWith(true);
    expect(screen.getByRole("textbox", { name: "دستاویز کا عنوان" })).toHaveValue("سونے کا نصاب");
  });

  it("has no back button, and keeps language out of the bar on a phone", () => {
    renderBar();
    expect(screen.queryByRole("button", { name: "Go back" })).not.toBeInTheDocument();
    for (const b of screen.getAllByRole("button", { name: "Switch Language / RTL" })) expect(b).toHaveClass("hidden");
  });

  it("offers language in “more”", () => {
    renderBar();
    fireEvent.keyDown(screen.getByRole("button", { name: "More options" }), { key: "Enter" });
    fireEvent.click(within(screen.getByRole("menu")).getByText("Switch Language / RTL"));
    expect(setLanguage).toHaveBeenCalledWith("en");
  });
});
