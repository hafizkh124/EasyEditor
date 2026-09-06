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

let documentOutline: string[] = [];
vi.mock("@/core/workspace/WorkspaceContext", () => ({
  useOptionalWorkspace: () => ({ documentOutline }),
}));

// jsdom has no Web Audio / MediaRecorder — stub just enough for the mic path.
vi.mock("@/lib/audio/chunker", () => ({
  decodeAudioFile: vi.fn(async () => ({}) as AudioBuffer),
  // jsdom's Blob has no arrayBuffer(), so hand back a blob-like with one.
  encodeChunkToWav: vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })),
}));

const { streamResearchQuery } = vi.hoisted(() => ({ streamResearchQuery: vi.fn() }));
vi.mock("@/lib/research/streamers", () => ({ streamResearchQuery }));

class FakeMediaRecorder {
  static isTypeSupported() { return true; }
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType = "audio/webm";
  constructor(_stream: unknown, _opts: unknown) {}
  start() { this.ondataavailable?.({ data: new Blob(["x"], { type: "audio/webm" }) }); }
  stop() { this.onstop?.(); }
}

import { AgentPanel } from "@/components/workspace/AgentPanel";

let onProgressCb: ((p: { id: string; step?: number; label?: string; kind: string; detail?: string; requestId?: string; query?: string }) => void) | null = null;
const agentRun = vi.fn(async () => ({ answer: "The chapter has 3 headings.", stopReason: "done", steps: 2, toolCalls: [{ name: "read_document", args: { chapter: "01-intro.docx" } as Record<string, unknown>, result: {} as unknown }], playbook: undefined as string | undefined }));
const transcribe = vi.fn(async () => [{ start: 0, end: 1, text: "footnote chapter one" }]);
const applyGlobalOption = vi.fn(async () => ({ option: "check_spelling", previous: "true", applied: "false" }));
const revertGlobalOptions = vi.fn(async () => ({ reverted: [{ option: "check_spelling", to: "true" }] }));
const submitGeneralSearch = vi.fn(async () => ({ ok: true }));

function mockApi(over: Partial<typeof pf> = {}) {
  Object.assign(pf, over);
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    isDesktop: true,
    agent: {
      run: agentRun,
      cancel: vi.fn(async () => ({ cancelled: true })),
      status: vi.fn(async () => ({ busy: false, running: null })),
      onProgress: vi.fn((cb: typeof onProgressCb) => { onProgressCb = cb; return () => { onProgressCb = null; }; }),
      applyGlobalOption,
      revertGlobalOptions,
      submitGeneralSearch,
      approvePlan: vi.fn(async () => ({ ok: true })),
    },
    docBridge: { detectTools: vi.fn(async () => ({ word: true, wordVersion: "16.0", windows: true })) },
    voice: { transcribe },
    projectFolder: {
      listAssets: vi.fn(async () => assetList),
      importAsset: vi.fn(async (_root: string, name: string) => {
        const rel = `media/${name.replace(/\s+/g, "_")}`;
        assetList = [...assetList, { name: rel, kind: "media" as const, ext: ".mp3", size: 10, modifiedAt: "x" }];
        return assetList[assetList.length - 1];
      }),
      getConnectors: vi.fn(async () => connectorState),
      setConnector: vi.fn(async (_root: string, id: string, on: boolean) => {
        connectorState = on ? { ...connectorState } : { ...connectorState, [id]: false };
        if (on) delete connectorState[id];
        return connectorState;
      }),
    },
  };
}
let assetList: Array<{ name: string; kind: "media" | "scan" | "asset"; ext: string; size: number; modifiedAt: string }> = [];
let connectorState: Record<string, boolean> = {};

beforeEach(() => {
  pf.folder = { path: "C:\\thesis", manifest: { id: "1", title: "My Thesis", createdAt: "x", chapterOrder: [], version: 1 } };
  documentOutline = [];
  streamResearchQuery.mockImplementation(async (o: { onDelta: (c: string) => void; onDone: () => void }) => {
    o.onDelta("Al-Ghazali was ");
    o.onDelta("a theologian.");
    o.onDone();
  });
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeMediaRecorder;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) },
  });
  mockApi();
});
afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  onProgressCb = null;
  assetList = [];
  connectorState = {};
  vi.clearAllMocks();
});

describe("AgentPanel", () => {
  it("prompts to open a project folder when none is open", () => {
    pf.folder = null as unknown as typeof pf.folder;
    render(<AgentPanel />);
    expect(screen.getByText(/The agent works on a folder of/)).toBeInTheDocument();
  });

  it("defaults to Ask mode and toggles to Auto", () => {
    render(<AgentPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Auto" }));
    // hint text switches
    expect(screen.getByText(/Every edit lands as a tracked change/)).toBeInTheDocument();
  });

  it("offers a Plan mode between Ask and Auto (M9 ADR-0026)", () => {
    render(<AgentPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Plan" }));
    expect(screen.getByText(/waits for your approval before changing anything/)).toBeInTheDocument();
  });

  it("sends the instruction, mode, and project root to the agent", async () => {
    render(<AgentPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Auto" }));
    const ta = screen.getByPlaceholderText(/Ask, or describe a task/);
    fireEvent.change(ta, { target: { value: "tidy chapter one" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    await waitFor(() => expect(agentRun).toHaveBeenCalledWith("tidy chapter one", "auto", "C:\\thesis"));
    expect(await screen.findByText("The chapter has 3 headings.")).toBeInTheDocument();
  });

  it("carries the original request and the agent's question into a clarification reply", async () => {
    agentRun.mockResolvedValueOnce({ answer: "", stopReason: "needs-input", steps: 1, toolCalls: [], question: "Which chapter do you mean?" });
    render(<AgentPanel />);
    const ta = screen.getByPlaceholderText(/Ask, or describe a task/);
    fireEvent.change(ta, { target: { value: "fix the spelling" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    await waitFor(() => expect(agentRun).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Which chapter do you mean?")).toBeInTheDocument();

    fireEvent.change(ta, { target: { value: "the introduction" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    await waitFor(() => expect(agentRun).toHaveBeenCalledTimes(2));
    const secondInstruction = agentRun.mock.calls[1][0] as string;
    expect(secondInstruction).toContain("fix the spelling");
    expect(secondInstruction).toContain("Which chapter do you mean?");
    expect(secondInstruction).toContain("the introduction");
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

  it("the + hub toggles a source connector and persists it (M9 Phase 1b)", async () => {
    render(<AgentPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Add files, folders, playbooks/ }));
    const shamela = screen.getByText("Maktaba Shamela").closest("label")!.querySelector("input")!;
    expect(shamela).toBeChecked();
    fireEvent.click(shamela);
    await waitFor(() => expect(window.electronAPI!.projectFolder!.setConnector).toHaveBeenCalledWith("C:\\thesis", "shamela", false));
    // the context pill now shows a source is off
    await waitFor(() => expect(screen.getByText(/source off/)).toBeInTheDocument());
  });

  it("collapses a finished multi-step run into a 'Ran N steps' card (M9 Phase 1b)", async () => {
    let resolveRun: (v: unknown) => void = () => {};
    agentRun.mockImplementationOnce(() => new Promise((r) => { resolveRun = r as (v: unknown) => void; }));
    render(<AgentPanel />);
    fireEvent.change(screen.getByPlaceholderText(/Ask, or describe a task/), { target: { value: "do a thing" } });
    fireEvent.keyDown(screen.getByPlaceholderText(/Ask, or describe a task/), { key: "Enter" });
    await waitFor(() => expect(onProgressCb).toBeTruthy());
    for (const label of ["reading the chapter", "searching Shamela", "inserting the footnote", "done"]) {
      onProgressCb!({ id: "1", step: 1, label, kind: label === "done" ? "done" : "tool" });
    }
    resolveRun({ answer: "finished", stopReason: "done", steps: 4, toolCalls: [] });
    expect(await screen.findByText(/Ran 4 steps/)).toBeInTheDocument();
    // still expandable
    fireEvent.click(screen.getByText(/Ran 4 steps/));
    expect(screen.getByText("searching Shamela")).toBeInTheDocument();
  });

  it("imports a dropped recording and inserts it as an @mention (M9 Phase 3)", async () => {
    render(<AgentPanel />);
    const panel = screen.getByPlaceholderText(/Ask, or describe a task/).closest("div.flex.flex-col.h-full")!;
    // jsdom's File has no arrayBuffer() — a minimal stand-in is enough here.
    const file = { name: "درس اول.mp3", type: "audio/mpeg", arrayBuffer: async () => new ArrayBuffer(3) };
    fireEvent.drop(panel, { dataTransfer: { files: [file], types: ["Files"] } });

    await waitFor(() => {
      const ta = screen.getByPlaceholderText(/Ask, or describe a task/) as HTMLTextAreaElement;
      expect(ta.value).toContain("@درس_اول.mp3");
    });
    expect(window.electronAPI!.projectFolder!.importAsset).toHaveBeenCalledWith("C:\\thesis", "درس اول.mp3", expect.anything());
  });

  it("offers the open document's headings as `@` mentions", async () => {
    documentOutline = ["Literature Review", "Methodology"];
    render(<AgentPanel />);
    const ta = screen.getByPlaceholderText(/Ask, or describe a task/) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "expand @method", selectionStart: 14 } });
    expect(await screen.findByText("§ Methodology")).toBeInTheDocument();
  });

  it("shows the mic only when voice transcription is available", () => {
    const { unmount } = render(<AgentPanel />);
    expect(screen.getByRole("button", { name: "Dictate" })).toBeInTheDocument();
    unmount();
    (window as unknown as { electronAPI?: Record<string, unknown> }).electronAPI!.voice = undefined;
    render(<AgentPanel />);
    expect(screen.queryByRole("button", { name: "Dictate" })).not.toBeInTheDocument();
  });

  it("shows a consent card for a set_global_option request and applies it on click", async () => {
    agentRun.mockResolvedValueOnce({
      answer: "I can turn off spell-check, but you need to approve it.",
      stopReason: "done", steps: 1, playbook: undefined,
      toolCalls: [{ name: "set_global_option", args: { option: "check_spelling", value: "false" }, result: { needsConsent: true, option: "check_spelling", value: "false", current: "true", message: "approve this" } }],
    });
    render(<AgentPanel />);
    const ta = screen.getByPlaceholderText(/Ask, or describe a task/);
    fireEvent.change(ta, { target: { value: "turn off spell check everywhere" } });
    fireEvent.keyDown(ta, { key: "Enter" });

    const applyBtn = await screen.findByRole("button", { name: /Apply 1 change/ });
    fireEvent.click(applyBtn);
    await waitFor(() => expect(applyGlobalOption).toHaveBeenCalledWith("C:\\thesis", "check_spelling", "false"));
    expect(await screen.findByRole("button", { name: /Revert Word settings/ })).toBeInTheDocument();
  });

  it("answers a general-search-request from the agent via the research streamer", async () => {
    let resolveRun: (v: unknown) => void = () => {};
    agentRun.mockImplementationOnce(() => new Promise((r) => { resolveRun = r as (v: unknown) => void; }));
    render(<AgentPanel />);
    const ta = screen.getByPlaceholderText(/Ask, or describe a task/);
    fireEvent.change(ta, { target: { value: "who was al-Ghazali" } });
    fireEvent.keyDown(ta, { key: "Enter" });

    await waitFor(() => expect(onProgressCb).toBeTruthy());
    onProgressCb!({ id: "1", kind: "general-search-request", requestId: "req_9", query: "al-Ghazali" });

    await waitFor(() => expect(streamResearchQuery).toHaveBeenCalled());
    await waitFor(() => expect(submitGeneralSearch).toHaveBeenCalledWith("req_9", { answer: "Al-Ghazali was a theologian.", channel: "general" }));
    resolveRun({ answer: "done", stopReason: "done", steps: 1, toolCalls: [], playbook: undefined });
  });

  it("dictates a transcript into the input", async () => {
    render(<AgentPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Dictate" }));
    // FakeMediaRecorder.start() pushed a chunk; clicking again stops → transcribe.
    fireEvent.click(await screen.findByRole("button", { name: "Stop dictation" }));
    await waitFor(() => expect(transcribe).toHaveBeenCalled());
    const ta = screen.getByPlaceholderText(/Ask, or describe a task/) as HTMLTextAreaElement;
    await waitFor(() => expect(ta.value).toContain("footnote chapter one"));
  });
});
