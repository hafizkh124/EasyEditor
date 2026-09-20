import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * M10 Phase 2.5.3 — the web BYOK panel. A deliberately simpler UI than
 * desktop's (one dropdown, one key field, no per-role split, no eval gate —
 * see WebByokKeyPanel.tsx's own doc comment). Covers what's specific to it:
 * status loads on mount, save runs test-then-save (never saves an unverified
 * key), delete is scoped to the selected provider, and the key never leaks
 * into any rendered text.
 */
vi.mock("@/lib/logger", () => ({ logger: { child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) } }));

const invokeMock = vi.fn();
vi.mock("@/core/ai/aiAdapter", () => ({
  callEdgeFunction: (...args: unknown[]) => invokeMock(...args),
}));

import { WebByokKeyPanel } from "@/components/settings/WebByokKeyPanel";

const ALL_UNSET = {
  gemini: { hasKey: false, lastFour: null },
  groq: { hasKey: false, lastFour: null },
  openrouter: { hasKey: false, lastFour: null },
};

beforeEach(() => {
  invokeMock.mockReset();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});
afterEach(() => { delete (window as unknown as { electronAPI?: unknown }).electronAPI; });

function mockStatus(data: unknown) {
  invokeMock.mockImplementation(async (_name: string, body: { action: string }) => {
    if (body.action === "status") return { data };
    return { data: null };
  });
}

describe("WebByokKeyPanel", () => {
  it("loads and shows the status for all three providers on mount", async () => {
    mockStatus({ ...ALL_UNSET, groq: { hasKey: true, lastFour: "wxyz" } });
    render(<WebByokKeyPanel />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("byok-keys", { action: "status" }));
    // Default selected provider is gemini, which has no key — the "get a key" link shows.
    expect(await screen.findByText(/Get a key|کلید حاصل کریں/)).toBeInTheDocument();
  });

  it("shows the saved indicator (never the key itself) when the selected provider already has one", async () => {
    mockStatus({ ...ALL_UNSET, gemini: { hasKey: true, lastFour: "aB3x" } });
    render(<WebByokKeyPanel />);
    await waitFor(() => expect(screen.getByText(/aB3x/)).toBeInTheDocument());
  });

  it("tests a key before saving it, and never saves an unverified one", async () => {
    mockStatus(ALL_UNSET);
    invokeMock.mockImplementation(async (_name: string, body: { action: string }) => {
      if (body.action === "status") return { data: ALL_UNSET };
      if (body.action === "test") return { data: { success: false, message: "key رد ہو گئی" } };
      return { data: { hasKey: true, lastFour: "zzzz" } }; // save — should never be reached
    });
    render(<WebByokKeyPanel />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());

    const input = screen.getByPlaceholderText("AIzaSy…");
    fireEvent.change(input, { target: { value: "AIzaSyBadKey0000000000000000000000" } });
    fireEvent.click(screen.getByText(/Save & verify|محفوظ و تصدیق/));

    await waitFor(() => expect(screen.getByText("key رد ہو گئی")).toBeInTheDocument());
    expect(invokeMock).not.toHaveBeenCalledWith("byok-keys", expect.objectContaining({ action: "save" }));
  });

  it("saves only after a successful test, scoped to the selected provider", async () => {
    const calls: Array<Record<string, unknown>> = [];
    invokeMock.mockImplementation(async (_name: string, body: Record<string, unknown>) => {
      calls.push(body);
      if (body.action === "status") return { data: ALL_UNSET };
      if (body.action === "test") return { data: { success: true, message: "ok" } };
      return { data: { hasKey: true, lastFour: "aaaa" } };
    });
    render(<WebByokKeyPanel />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());

    const input = screen.getByPlaceholderText("AIzaSy…");
    fireEvent.change(input, { target: { value: "AIzaSyGoodKey000000000000000000000" } });
    fireEvent.click(screen.getByText(/Save & verify|محفوظ و تصدیق/));

    await waitFor(() => expect(calls.some((c) => c.action === "save")).toBe(true));
    const save = calls.find((c) => c.action === "save")!;
    expect(save.provider).toBe("gemini");
    expect(save.key).toBe("AIzaSyGoodKey000000000000000000000");
  });

  it("never renders the raw key anywhere after a successful save", async () => {
    invokeMock.mockImplementation(async (_name: string, body: Record<string, unknown>) => {
      if (body.action === "status") return { data: ALL_UNSET };
      if (body.action === "test") return { data: { success: true, message: "ok" } };
      return { data: { hasKey: true, lastFour: "aaaa" } };
    });
    render(<WebByokKeyPanel />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    const input = screen.getByPlaceholderText("AIzaSy…");
    fireEvent.change(input, { target: { value: "AIzaSySecretDoNotLeak0000000000000" } });
    fireEvent.click(screen.getByText(/Save & verify|محفوظ و تصدیق/));
    await waitFor(() => expect(screen.queryByDisplayValue("AIzaSySecretDoNotLeak0000000000000")).not.toBeInTheDocument());
    expect(document.body.textContent).not.toContain("AIzaSySecretDoNotLeak0000000000000");
  });

  it("deletes the currently selected provider's key", async () => {
    const calls: Array<Record<string, unknown>> = [];
    invokeMock.mockImplementation(async (_name: string, body: Record<string, unknown>) => {
      calls.push(body);
      if (body.action === "status") return { data: { ...ALL_UNSET, gemini: { hasKey: true, lastFour: "aaaa" } } };
      return { data: { ok: true } };
    });
    render(<WebByokKeyPanel />);
    await waitFor(() => expect(screen.getByText(/aaaa/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/^Delete$|^حذف$/));
    await waitFor(() => expect(calls.some((c) => c.action === "delete" && c.provider === "gemini")).toBe(true));
  });

  it("handles cohere rerank provider in status map without crashing", async () => {
    mockStatus({ ...ALL_UNSET, cohere: { hasKey: true, lastFour: "9999" } });
    render(<WebByokKeyPanel />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("byok-keys", { action: "status" }));
    expect(screen.getByText(/Get a key|کلید حاصل کریں/)).toBeInTheDocument();
  });
});
