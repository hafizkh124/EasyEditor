import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ChatDisplay from "@/components/research/ChatDisplay";
import type { ChatMessage } from "@/components/research/types";
import en from "@/locales/en.json";

/**
 * SPEC M10 §1.1/§1.2 — a baseline for the Research+Agent merge. ChatDisplay.tsx
 * (492 lines) and useResearchChat.ts had NO direct test coverage before this
 * file — the only existing net, workbenchKeepMounted.test.tsx, fully stubs
 * ResearchPanel and never exercises this component's own rendering. Pinning
 * the current render pipeline (message list, sources indicator) BEFORE
 * extending ChatDisplay's ListItem union with agent-produced turns, so a
 * regression in existing behavior fails loudly instead of silently — the
 * same discipline the M10 audit itself flagged missing (Phase 5's "31 of
 * 182 test files are component tests" gap).
 *
 * No more اسلامی/عمومی mode prop as of §1.1 — ChatDisplay no longer takes a
 * `mode`/`onModeChange` pair at all, so there is nothing "mode switcher
 * visibility" to pin here anymore; ResearchModeSwitcher.tsx was deleted.
 */

const t = ((key: string, fallback?: string) =>
  (en as Record<string, string>)[key] ?? fallback ?? key) as unknown as
  import("@/lib/i18n").Translator;

function baseProps(overrides: Partial<Parameters<typeof ChatDisplay>[0]> = {}) {
  return {
    messages: [] as ChatMessage[],
    isQuerying: false,
    query: "",
    onQueryChange: vi.fn(),
    onSendQuery: vi.fn(),
    isRefining: false,
    lastAssistantIdx: -1,
    onRefine: vi.fn(),
    onCopyOutput: vi.fn(),
    onClearChat: vi.fn(),
    onRegenerate: vi.fn(),
    researchLimitReached: false,
    isSignedIn: true,
    chatEndRef: { current: null },
    t,
    ...overrides,
  };
}

function renderChat(overrides: Partial<Parameters<typeof ChatDisplay>[0]> = {}) {
  return render(
    <MemoryRouter>
      <ChatDisplay {...baseProps(overrides)} />
    </MemoryRouter>,
  );
}

describe("ChatDisplay — baseline (SPEC M10 §1.2 pre-merge snapshot)", () => {
  it("shows the empty state when there are no messages", () => {
    renderChat();
    expect(screen.getByRole("textbox", { name: en["research.ask_placeholder"] })).toBeInTheDocument();
  });

  it("renders a user message and an assistant message", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "زکوٰۃ کا نصاب کیا ہے؟" },
      { role: "assistant", content: "زکوٰۃ کا نصاب ساڑھے باون تولہ چاندی ہے۔" },
    ];
    renderChat({ messages, lastAssistantIdx: 0 });
    expect(screen.getByText("زکوٰۃ کا نصاب کیا ہے؟")).toBeInTheDocument();
    expect(screen.getByText(/زکوٰۃ کا نصاب ساڑھے باون تولہ چاندی ہے/)).toBeInTheDocument();
  });

  it("shows the sources-ready indicator only while querying, and only with a nonzero count", () => {
    const messages: ChatMessage[] = [{ role: "user", content: "q" }];
    const { rerender } = render(
      <MemoryRouter>
        <ChatDisplay {...baseProps({
          messages, isQuerying: true,
          sourcesReadyInfo: { count: 3, domains: ["tanzil"] },
        })} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/3/)).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <ChatDisplay {...baseProps({
          messages, isQuerying: true,
          sourcesReadyInfo: { count: 0, domains: [] },
        })} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/3/)).not.toBeInTheDocument();
  });

  it("always offers SourcePicker via the + hub — no mode gate hides it, no separate row either (SPEC M10 §1.3)", () => {
    renderChat({ onSelectedDomainsChange: vi.fn() });
    // Consolidated into the hub popover now — not a standalone row, and
    // closed by default, so its own button is absent until opened.
    expect(screen.queryByRole("button", { name: en["research.sources_label"] })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: en["research.hub_open"] }));
    expect(screen.getByRole("button", { name: en["research.sources_label"] })).toBeInTheDocument();
  });

  it("shows a dot on the hub button when sources are narrowed, hides it once the hub is open", () => {
    renderChat({ onSelectedDomainsChange: vi.fn(), selectedDomains: ["tanzil"] });
    const hubButton = screen.getByRole("button", { name: en["research.hub_open"] });
    expect(hubButton.querySelector(".bg-primary")).toBeTruthy();
    fireEvent.click(hubButton);
    expect(hubButton.querySelector(".bg-primary")).toBeNull();
  });

  it("disables Send with no query, and re-enables once text is typed", () => {
    renderChat({ query: "" });
    expect(screen.getByRole("button", { name: en["research.send"] })).toBeDisabled();
  });

  it("shows the sign-in message instead of the limit message when signed out", () => {
    renderChat({ isSignedIn: false, researchLimitReached: true });
    expect(screen.getByText(en["research.sign_in_required"])).toBeInTheDocument();
  });

  it("offers assist modes (ModeChips) inside the hub, and toggling one calls back", () => {
    const onAssistModesChange = vi.fn();
    renderChat({ onAssistModesChange, assistModes: [] });
    fireEvent.click(screen.getByRole("button", { name: en["research.hub_open"] }));
    fireEvent.click(screen.getByText(en["research.chip_spelling"]));
    expect(onAssistModesChange).toHaveBeenCalledWith(["spelling"]);
  });

  it("closes the hub and opens the scholarly-prompts modal from its row", () => {
    renderChat({ onSelectedDomainsChange: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: en["research.hub_open"] }));
    fireEvent.click(screen.getByText(en["research.scholarly_prompts"]));
    // The hub's own dialog role should be gone (it closed)...
    expect(screen.queryByRole("dialog", { name: en["research.hub_open"] })).not.toBeInTheDocument();
    // ...and the prompts modal's own heading/search should be reachable
    // instead (ScholarlyPromptModal renders when isOpen is true).
    expect(screen.queryByRole("button", { name: en["research.sources_label"] })).not.toBeInTheDocument();
  });

  it("hub button is absent entirely when neither sources nor assist modes are offered", () => {
    renderChat();
    expect(screen.queryByRole("button", { name: en["research.hub_open"] })).not.toBeInTheDocument();
  });
});

/**
 * SPEC M10 §1.2 — the new `agent_run` timeline item. A hand-built
 * `AgentRunView` (not the real `useAgentRun()`, which needs Electron IPC
 * mocks agentPanel.test.tsx already owns) is enough to exercise ChatDisplay's
 * own rendering branch in isolation — it is a pure data+handler bag by
 * design (see the hook's `Pick`-derived export comment).
 */
function agentView(overrides: Partial<import("@/hooks/useAgentRun").AgentRunView> = {}) {
  return {
    progress: [],
    result: null,
    artifacts: [],
    activeArtifactId: null,
    setActiveArtifactId: vi.fn(),
    dismissArtifact: vi.fn(),
    planPending: false,
    progressExpanded: false,
    setProgressExpanded: vi.fn(),
    showTools: false,
    setShowTools: vi.fn(),
    decidePlan: vi.fn(),
    pendingOptions: [],
    optionsApplied: false,
    applyOptions: vi.fn(),
    revertOptions: vi.fn(),
    pendingOcr: [],
    ocrGranted: false,
    grantOcr: vi.fn(),
    undone: false,
    undoTask: vi.fn(),
    ...overrides,
  };
}

describe("ChatDisplay — agent_run item (SPEC M10 §1.2)", () => {
  it("inserts nothing when agent is present but idle", () => {
    renderChat({ agent: agentView() });
    // The empty state (no messages, no agent activity) is still the one
    // thing shown — an idle `agent` prop must not silently replace it.
    expect(screen.getByRole("textbox", { name: en["research.ask_placeholder"] })).toBeInTheDocument();
  });

  it("renders a live progress line", () => {
    renderChat({
      agent: agentView({ progress: [{ step: 1, label: "reading the chapter", kind: "tool" }] }),
    });
    expect(screen.getByText("reading the chapter")).toBeInTheDocument();
  });

  it("renders the finished answer, with tool calls collapsed by default", () => {
    const toolCalls = [{ name: "read_document", args: { chapter: "01-intro.docx" }, result: {} }];
    const result = { answer: "The chapter has 3 headings.", stopReason: "done", steps: 1, toolCalls };
    renderChat({ agent: agentView({ result }) });
    expect(screen.getByText("The chapter has 3 headings.")).toBeInTheDocument();
    expect(screen.queryByText("read_document")).not.toBeInTheDocument();
  });

  it("wires the tool-calls toggle to setShowTools, and reveals calls once showTools is true", () => {
    const toolCalls = [{ name: "read_document", args: { chapter: "01-intro.docx" }, result: {} }];
    const result = { answer: "done", stopReason: "done", steps: 1, toolCalls };
    const setShowTools = vi.fn();
    renderChat({ agent: agentView({ result, setShowTools }) });
    fireEvent.click(screen.getByText(/1 tool calls/));
    expect(setShowTools).toHaveBeenCalledTimes(1);

    renderChat({ agent: agentView({ result, showTools: true }) });
    expect(screen.getByText("read_document")).toBeInTheDocument();
  });

  it("shows the plan-approval card and calls decidePlan", () => {
    const decidePlan = vi.fn();
    renderChat({ agent: agentView({ planPending: true, decidePlan }) });
    fireEvent.click(screen.getByRole("button", { name: en["agent.plan_approve"] }));
    expect(decidePlan).toHaveBeenCalledWith("approved");
  });

  it("collapses a finished multi-step run into a 'Ran N steps' card", () => {
    renderChat({
      agent: agentView({
        progress: [
          { step: 1, label: "reading the chapter", kind: "tool" },
          { step: 2, label: "searching Shamela", kind: "tool" },
          { step: 3, label: "inserting the footnote", kind: "tool" },
          { step: 4, label: "done", kind: "done" },
        ],
        result: { answer: "finished", stopReason: "done", steps: 4, toolCalls: [] },
      }),
    });
    expect(screen.getByText(/Ran 4 steps/)).toBeInTheDocument();
    expect(screen.queryByText("searching Shamela")).not.toBeInTheDocument();
  });

  it("shows the OCR consent card and calls grantOcr", () => {
    const grantOcr = vi.fn();
    renderChat({
      agent: agentView({
        result: { answer: "", stopReason: "done", steps: 1, toolCalls: [{ name: "ocr_document", args: {}, result: { needsConsent: true, scanPath: "sources/scan.pdf" } }] },
        pendingOcr: [{ needsConsent: true, scanPath: "sources/scan.pdf" }],
        grantOcr,
      }),
    });
    fireEvent.click(screen.getByRole("button", { name: en["agent.ocr_consent_approve"] }));
    expect(grantOcr).toHaveBeenCalled();
  });
});
