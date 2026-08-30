import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * SPEC-M8 P8b — the Agent tab. What must hold: with no project folder it
 * prompts to open one; Ask/Do toggles; sending forwards the instruction +
 * mode + project root to the agent IPC; live progress lines render; `/`
 * opens the playbook picker and `@` the chapter picker.
 */
vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (k: string, f?: string) => f ?? k, language: "ur", setLanguage: vi.fn(), direction: "rtl" }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const pf = {
  supported: true,
  folder: { path: "C:\\thesis", manifest: { id: "1", title: "My Thesis", createdAt: "x", chapterOrder: [], version: 1 } },
  chapters: [
    { name: "01-intro.docx", format: "docx", size: 1, modifiedAt: "x", order: 0 },
    { name: "02-body.docx", format: "docx", size: 1, modifiedAt: "x", order: 1 },
  ],
  busy: false,
  externalChange: null as string | null,
  dismissExternalChange: vi.fn(),
  openFolder: vi.fn(),
  closeFolder: vi.fn(),
  refresh: vi.fn(),
  importChapter: vi.fn(),
  saveChapter: vi.fn(),
};
vi.mock("@/core/projectFolder/context", () => ({ useProjectFolderContext: () => pf }));

import { AgentPanel } from "@/components/workspace/AgentPanel";

let onProgressCb: ((p: { id: string; step: number; label: string; kind: string; detail?: string }) => void) | null = null;
const agentRun = vi.fn(async () => ({ answer: "The chapter has 3 headings.", stopReason: "done", steps: 2, toolCalls: [{ name: "read_document", args: { chapter: "01-intro.docx" }, result: {} }], playbook: undefined }));

function mockApi(over: Partial<typeof pf> = {}) {
  Object.assign(pf, over);
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    isDesktop: true,
    agent: {
      run: agentRun,
      cancel: vi.fn(async () => ({ cancelled: true })),
      status: vi.fn(async () => ({ busy: false, running: null })),
      onProgress: vi.fn((cb: typeof onProgressCb) => { onProgressCb = cb; return () => { onProgressCb = null; }; }),
    },
    docBridge: { detectTools: vi.fn(async () => ({ word: true, wordVersion: "16.0", windows: true })) },
  };
}

beforeEach(() => {
  pf.folder = { path: "C:\\thesis", manifest: { id: "1", title: "My Thesis", createdAt: "x", chapterOrder: [], version: 1 } };
  mockApi();
});
afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  onProgressCb = null;
  vi.clearAllMocks();
});

describe("AgentPanel", () => {
  it("prompts to open a project folder when none is open", () => {
    pf.folder = null as unknown as typeof pf.folder;
    render(<AgentPanel />);
    expect(screen.getByText(/Open a project folder in the Library/)).toBeInTheDocument();
  });

  it("defaults to Ask mode and toggles to Do", () => {
    render(<AgentPanel />);
    const doBtn = screen.getByRole("button", { name: "Do" });
    fireEvent.click(doBtn);
    // hint text switches
    expect(screen.getByText(/Every edit lands as a tracked change/)).toBeInTheDocument();
  });

  it("sends the instruction, mode, and project root to the agent", async () => {
    render(<AgentPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Do" }));
    const ta = screen.getByPlaceholderText(/Ask, or describe a task/);
    fireEvent.change(ta, { target: { value: "tidy chapter one" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    await waitFor(() => expect(agentRun).toHaveBeenCalledWith("tidy chapter one", "do", "C:\\thesis"));
    expect(await screen.findByText("The chapter has 3 headings.")).toBeInTheDocument();
  });

  it("renders live progress lines as they arrive", async () => {
    let resolveRun: (v: unknown) => void = () => {};
    agentRun.mockImplementationOnce(() => new Promise((r) => { resolveRun = r as (v: unknown) => void; }));
    render(<AgentPanel />);
    const ta = screen.getByPlaceholderText(/Ask, or describe a task/);
    fireEvent.change(ta, { target: { value: "what headings are there" } });
    fireEvent.keyDown(ta, { key: "Enter" });

    await waitFor(() => expect(onProgressCb).toBeTruthy());
    onProgressCb!({ id: "1", step: 1, label: "reading the chapter", kind: "tool" });
    expect(await screen.findByText("reading the chapter")).toBeInTheDocument();
    resolveRun({ answer: "done", stopReason: "done", steps: 1, toolCalls: [] });
  });

  it("opens the playbook picker on '/'", async () => {
    render(<AgentPanel />);
    const ta = screen.getByPlaceholderText(/Ask, or describe a task/);
    fireEvent.change(ta, { target: { value: "/thesis" } });
    expect(await screen.findByText(/university thesis format/i)).toBeInTheDocument();
  });

  it("opens the chapter picker on '@'", async () => {
    render(<AgentPanel />);
    const ta = screen.getByPlaceholderText(/Ask, or describe a task/) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "check @body", selectionStart: 10 } });
    expect(await screen.findByText("02-body.docx")).toBeInTheDocument();
  });
});
