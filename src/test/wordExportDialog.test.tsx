import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * SPEC-M8 P3 — the desktop "export through Word" dialog. What must hold: the
 * loss list is fetched and shown BEFORE the user runs anything (§4 honesty),
 * Export goes through the main-process save dialog + adapter, and the result
 * can be opened. Also: the entry point only appears when the doc bridge is
 * actually present (desktop + electronAPI.docBridge).
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
    workbenchCollapsed: false, toggleWorkbench: vi.fn(), setCommandPaletteOpen: vi.fn(),
    mobileLibraryOpen: false, setMobileLibraryOpen: vi.fn(),
  }),
}));
vi.mock("@/components/workspace/WorkspaceAppMenu", () => ({ WorkspaceAppMenu: () => <div /> }));
vi.mock("@/components/auth/DesktopAccountMenu", () => ({ DesktopAccountMenu: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { WordExportDialog } from "@/components/editor/WordExportDialog";
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar";
import type { Document } from "@/core/workspace/types";

type DocBridge = NonNullable<NonNullable<Window["electronAPI"]>["docBridge"]>;

function mockBridge(over: Partial<DocBridge> = {}) {
  const bridge = {
    detectTools: vi.fn(),
    ping: vi.fn(),
    wordDescriptor: vi.fn(),
    toWord: vi.fn(),
    fromWord: vi.fn(),
    reflowPdf: vi.fn(),
    readStructure: vi.fn(),
    installFont: vi.fn(),
    planConversion: vi.fn(async () => ({ ok: true as const, steps: [], losses: ["Exact page layout is lost."] })),
    exportDocument: vi.fn(async () => ({ cancelled: false as const, outputPath: "C:\\Users\\me\\thesis.pdf", losses: [], ms: 9 })),
    openPath: vi.fn(async () => ({ opened: true })),
    onProgress: vi.fn(() => () => {}),
    ...over,
  } as unknown as DocBridge;
  (window as unknown as { electronAPI?: unknown }).electronAPI = { isDesktop: true, docBridge: bridge };
  return bridge;
}

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  vi.clearAllMocks();
});

describe("WordExportDialog", () => {
  it("fetches and shows the loss list for the selected target before running", async () => {
    const bridge = mockBridge();
    render(<WordExportDialog open onOpenChange={vi.fn()} html="<p>x</p>" title="Thesis" />);

    await waitFor(() => expect(bridge.planConversion).toHaveBeenCalledWith("html", "docx"));
    expect(await screen.findByText("Exact page layout is lost.")).toBeInTheDocument();
  });

  it("re-plans when the target format changes", async () => {
    const bridge = mockBridge();
    render(<WordExportDialog open onOpenChange={vi.fn()} html="<p>x</p>" title="Thesis" />);
    await waitFor(() => expect(bridge.planConversion).toHaveBeenCalledWith("html", "docx"));

    fireEvent.click(screen.getByLabelText("PDF"));
    await waitFor(() => expect(bridge.planConversion).toHaveBeenCalledWith("html", "pdf"));
  });

  it("Export runs the conversion, then offers to open the result", async () => {
    const bridge = mockBridge();
    render(<WordExportDialog open onOpenChange={vi.fn()} html="<p>سلام</p>" title="Thesis" />);
    await waitFor(() => expect(bridge.planConversion).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() =>
      expect(bridge.exportDocument).toHaveBeenCalledWith("<p>سلام</p>", "Thesis", "docx", { rtlPageSetup: true, trackChanges: false }),
    );

    const openBtn = await screen.findByRole("button", { name: "Open file" });
    fireEvent.click(openBtn);
    expect(bridge.openPath).toHaveBeenCalledWith("C:\\Users\\me\\thesis.pdf");
  });

  it("a cancelled save dialog leaves the dialog usable, no result shown", async () => {
    const bridge = mockBridge({ exportDocument: vi.fn(async () => ({ cancelled: true as const })) });
    render(<WordExportDialog open onOpenChange={vi.fn()} html="<p>x</p>" title="T" />);
    await waitFor(() => expect(bridge.planConversion).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(bridge.exportDocument).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Open file" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
  });
});

const topBarProps = {
  doc: { id: "d1", title: "میری دستاویز" } as unknown as Document,
  saveStatus: "saved" as const,
  versions: [],
  currentText: "متن",
  currentHtml: "<p>متن</p>",
  onTitleChange: vi.fn(),
  onRestoreVersion: vi.fn(),
  onCreateSnapshot: vi.fn(async () => undefined),
};

function openExportMenu() {
  const trigger = screen.getAllByRole("button").find((b) => b.querySelector("svg.lucide-chevron-down"));
  fireEvent.keyDown(trigger!, { key: "Enter" });
}

describe("WorkspaceTopBar — Word export entry point", () => {
  it("shows the 'Through Word' item when the doc bridge is present", () => {
    mockBridge();
    render(<MemoryRouter><WorkspaceTopBar {...topBarProps} /></MemoryRouter>);
    openExportMenu();
    expect(screen.getByText("Through Word (high fidelity)")).toBeInTheDocument();
  });

  it("hides it on the web (no docBridge)", () => {
    (window as unknown as { electronAPI?: unknown }).electronAPI = { isDesktop: true };
    render(<MemoryRouter><WorkspaceTopBar {...topBarProps} /></MemoryRouter>);
    openExportMenu();
    expect(screen.queryByText("Through Word (high fidelity)")).not.toBeInTheDocument();
  });
});
