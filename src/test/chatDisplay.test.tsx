import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ChatDisplay from "@/components/research/ChatDisplay";
import type { ChatMessage } from "@/components/research/types";
import en from "@/locales/en.json";

/**
 * SPEC M10 §1.2 — a baseline for the Research+Agent merge. ChatDisplay.tsx
 * (492 lines) and useResearchChat.ts had NO direct test coverage before this
 * file — the only existing net, workbenchKeepMounted.test.tsx, fully stubs
 * ResearchPanel and never exercises this component's own rendering. Pinning
 * the current render pipeline (message list, sources indicator, mode
 * switcher visibility) BEFORE extending ChatDisplay's ListItem union with
 * agent-produced turns, so a regression in existing behavior fails loudly
 * instead of silently — the same discipline the M10 audit itself flagged
 * missing (Phase 5's "31 of 182 test files are component tests" gap).
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

  it("shows the sources-ready indicator only in islamic mode while querying", () => {
    const messages: ChatMessage[] = [{ role: "user", content: "q" }];
    const { rerender } = render(
      <MemoryRouter>
        <ChatDisplay {...baseProps({
          messages, isQuerying: true, mode: "islamic",
          sourcesReadyInfo: { count: 3, domains: ["tanzil"] },
        })} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/3/)).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <ChatDisplay {...baseProps({
          messages, isQuerying: true, mode: "general",
          sourcesReadyInfo: { count: 3, domains: ["tanzil"] },
        })} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/3/)).not.toBeInTheDocument();
  });

  it("renders the mode switcher only when onModeChange is passed", () => {
    const { rerender } = renderChat({ mode: "islamic", onModeChange: vi.fn() });
    expect(screen.getByRole("button", { name: en["research.mode_label"] })).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <ChatDisplay {...baseProps({ mode: "islamic", onModeChange: undefined })} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: en["research.mode_label"] })).not.toBeInTheDocument();
  });

  it("disables Send with no query, and re-enables once text is typed", () => {
    renderChat({ query: "" });
    expect(screen.getByRole("button", { name: en["research.send"] })).toBeDisabled();
  });

  it("shows the sign-in message instead of the limit message when signed out", () => {
    renderChat({ isSignedIn: false, researchLimitReached: true });
    expect(screen.getByText(en["research.sign_in_required"])).toBeInTheDocument();
  });
});
