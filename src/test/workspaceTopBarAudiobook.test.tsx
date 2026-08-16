import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * UX-v1 P3 — the audiobook export (SPEC-M5 FR-6.9) used to live only on the
 * /editor page. That page redirected to /workspace on every shipped build
 * (VITE_WORKSPACE_SHELL had no way to be "false"), so the feature was
 * unreachable while `audiobookExport.test.ts` — which only exercises the
 * Electron-side encoder — stayed green throughout. This pins the UI itself
 * down on its new home, WorkspaceTopBar, so that gap cannot reopen silently.
 */

vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    language: "ur",
    setLanguage: vi.fn(),
    direction: "rtl",
  }),
}));

vi.mock("@/core/workspace/WorkspaceContext", () => ({
  useWorkspace: () => ({
    workbenchCollapsed: false,
    toggleWorkbench: vi.fn(),
    setCommandPaletteOpen: vi.fn(),
    mobileLibraryOpen: false,
    setMobileLibraryOpen: vi.fn(),
  }),
}));

vi.mock("@/components/workspace/WorkspaceAppMenu", () => ({
  WorkspaceAppMenu: () => <div data-testid="app-menu-stub" />,
}));
vi.mock("@/components/auth/DesktopAccountMenu", () => ({
  DesktopAccountMenu: () => null,
}));

import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar";
import type { Document } from "@/core/workspace/types";

const baseProps = {
  doc: { id: "doc-1", title: "میری دستاویز" } as unknown as Document,
  saveStatus: "saved" as const,
  versions: [],
  currentText: "متن",
  currentHtml: "<p>متن</p>",
  onTitleChange: vi.fn(),
  onRestoreVersion: vi.fn(),
  onCreateSnapshot: vi.fn(async () => undefined),
};

function renderTopBar() {
  render(
    <MemoryRouter>
      <WorkspaceTopBar {...baseProps} />
    </MemoryRouter>,
  );
}

/** The desktop export dropdown is `hidden sm:flex`; jsdom has no media
 * queries, so it is present in the DOM regardless of viewport — exactly what
 * a `toBeInTheDocument` check needs. Opened by keyboard, as `workspaceAppMenu
 * .test.tsx` does: jsdom has no PointerEvent, which is what Radix's trigger
 * listens for on click. */
function openDesktopExportMenu() {
  const trigger = screen.getAllByRole("button").find((b) => b.querySelector("svg.lucide-chevron-down"));
  fireEvent.keyDown(trigger!, { key: "Enter" });
}

describe("WorkspaceTopBar audiobook export", () => {
  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  describe("on desktop with the voice engine present", () => {
    beforeEach(() => {
      (window as unknown as { electronAPI?: unknown }).electronAPI = {
        isDesktop: true,
        voice: {
          onAudiobookProgress: vi.fn(() => () => {}),
          exportAudiobook: vi.fn(),
          cancelAudiobook: vi.fn(),
        },
      };
    });

    it("offers the audiobook export from the download menu", () => {
      renderTopBar();
      openDesktopExportMenu();
      expect(screen.getByText("آڈیو بک (.mp3)")).toBeInTheDocument();
    });
  });

  describe("on the web", () => {
    it("does not offer an audiobook export — there is no local voice engine to run it", () => {
      renderTopBar();
      openDesktopExportMenu();
      expect(screen.queryByText("آڈیو بک (.mp3)")).not.toBeInTheDocument();
    });
  });
});
