import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * SPEC-M8 P7 — the Library's project-folder import list. What must hold: it is
 * invisible on the web, opening a folder lists its chapters, clicking a
 * chapter pulls its HTML (through the Word adapter, in main) and pushes it
 * into the editor, and an external-change notification surfaces a warning.
 */
vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (k: string, f?: string) => f ?? k, language: "ur", setLanguage: vi.fn(), direction: "rtl" }),
}));
const insertIntoCanvas = vi.fn();
vi.mock("@/core/workspace/WorkspaceContext", () => ({
  useWorkspace: () => ({ insertIntoCanvas }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { ProjectFolderSection } from "@/components/workspace/ProjectFolderSection";
import { ProjectFolderProvider } from "@/core/projectFolder/ProjectFolderContext";

let onChangedCb: ((p: { name: string; kind: "external" | "saving" }) => void) | null = null;

function mockBridge(over: Record<string, unknown> = {}) {
  const bridge = {
    pickFolder: vi.fn(async () => ({ cancelled: false, path: "C:\\thesis" })),
    open: vi.fn(async () => ({
      path: "C:\\thesis",
      manifest: { id: "id1", title: "My Thesis", createdAt: "2026-01-01", chapterOrder: [], version: 1 },
      chapters: [
        { name: "01-intro.docx", format: "docx", size: 10, modifiedAt: "2026-01-01", order: 0 },
        { name: "02-body.docx", format: "docx", size: 20, modifiedAt: "2026-01-01", order: 1 },
      ],
    })),
    listChapters: vi.fn(async () => []),
    readChapterHtml: vi.fn(async () => ({ html: "<p>باب کا متن</p>", name: "01-intro.docx", structure: {} })),
    saveChapter: vi.fn(),
    watch: vi.fn(async () => ({ watching: true })),
    unwatch: vi.fn(async () => ({ watching: false })),
    onChanged: vi.fn((cb: typeof onChangedCb) => { onChangedCb = cb; return () => { onChangedCb = null; }; }),
    ...over,
  };
  (window as unknown as { electronAPI?: unknown }).electronAPI = { isDesktop: true, projectFolder: bridge };
  return bridge;
}

const renderSection = () => render(<ProjectFolderProvider><ProjectFolderSection /></ProjectFolderProvider>);

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
});
afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  onChangedCb = null;
  vi.clearAllMocks();
});

describe("ProjectFolderSection", () => {
  it("renders nothing on the web", () => {
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
  });

  it("opens a folder and lists its chapters", async () => {
    mockBridge();
    renderSection();
    fireEvent.click(screen.getByText("Open a folder of .docx chapters"));
    expect(await screen.findByText("01-intro.docx")).toBeInTheDocument();
    expect(screen.getByText("02-body.docx")).toBeInTheDocument();
    expect(screen.getByText("My Thesis")).toBeInTheDocument();
  });

  it("clicking a chapter converts it and inserts the HTML into the editor", async () => {
    const bridge = mockBridge();
    renderSection();
    fireEvent.click(screen.getByText("Open a folder of .docx chapters"));
    fireEvent.click(await screen.findByText("01-intro.docx"));
    await waitFor(() => expect(bridge.readChapterHtml).toHaveBeenCalledWith("C:\\thesis", "01-intro.docx"));
    expect(insertIntoCanvas).toHaveBeenCalledWith("<p>باب کا متن</p>");
  });

  it("surfaces a warning when a chapter changes outside the app", async () => {
    mockBridge();
    renderSection();
    fireEvent.click(screen.getByText("Open a folder of .docx chapters"));
    await screen.findByText("01-intro.docx");
    onChangedCb?.({ name: "02-body.docx", kind: "external" });
    expect(await screen.findByText(/changed outside the app/)).toBeInTheDocument();
  });

  it("starts watching the folder once opened", async () => {
    const bridge = mockBridge();
    renderSection();
    fireEvent.click(screen.getByText("Open a folder of .docx chapters"));
    await screen.findByText("01-intro.docx");
    expect(bridge.watch).toHaveBeenCalledWith("C:\\thesis");
  });
});
