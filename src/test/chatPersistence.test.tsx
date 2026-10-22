import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import React from "react";

/**
 * SYSTEM-2026 §3 — the chat is saved after each answer, with its folder, and a
 * `?session=` link opens it again. It used to live only in memory.
 */

const upsert = vi.fn(async (p: { id: string | null }) => p.id ?? "s-new");
const load = vi.fn(async (id: string) => ({
  id,
  title: "t",
  mode: "general",
  project_id: "p9",
  messages: [
    { role: "user", content: "سوال" },
    { role: "assistant", content: "جواب" },
  ],
  citations: [],
  selected_domains: [],
  updated_at: "",
}));
vi.mock("@/lib/sessions/store", () => ({ getSessionStore: () => ({ upsert, load, loadLatest: vi.fn(), remove: vi.fn() }) }));

import { useChatPersistence, messagesToExchanges, exchangesToMessages, NEW_CHAT_EVENT } from "@/hooks/useChatPersistence";

type Args = Parameters<typeof useChatPersistence>[0];
const base = (over: Partial<Args> = {}): Args => ({
  userId: "u",
  exchanges: [],
  running: false,
  folderId: "p1",
  restore: vi.fn(),
  reset: vi.fn(),
  ...over,
});
const wrapper = (path = "/workspace") =>
  ({ children }: { children: React.ReactNode }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>;

describe("useChatPersistence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves after an answer, with the folder, then updates the same session", async () => {
    const { rerender } = renderHook((a: Args) => useChatPersistence(a), {
      initialProps: base({ exchanges: [{ instruction: "پہلا", answer: "جواب" }] }),
      wrapper: wrapper(),
    });
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(upsert.mock.calls[0][0]).toMatchObject({ id: null, title: "پہلا", projectId: "p1" });

    // The folder a chat started in sticks, even if another one is open now.
    rerender(base({ folderId: "p2", exchanges: [{ instruction: "پہلا", answer: "جواب" }, { instruction: "دوسرا", answer: "اور" }] }));
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(2));
    expect(upsert.mock.calls[1][0]).toMatchObject({ id: "s-new", projectId: "p1" });
  });

  it("does not save while an answer is still running, or the same thread twice", async () => {
    const ex = [{ instruction: "سوال", answer: "" }];
    const { rerender } = renderHook((a: Args) => useChatPersistence(a), { initialProps: base({ exchanges: ex, running: true }), wrapper: wrapper() });
    expect(upsert).not.toHaveBeenCalled();
    rerender(base({ exchanges: ex }));
    rerender(base({ exchanges: [...ex] }));
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
  });

  it("opens the chat a ?session= link names, and continues it", async () => {
    const restore = vi.fn();
    const { rerender } = renderHook((a: Args) => useChatPersistence(a), {
      initialProps: base({ restore }),
      wrapper: wrapper("/workspace?panel=research&session=s7"),
    });
    await waitFor(() => expect(restore).toHaveBeenCalledWith([{ instruction: "سوال", answer: "جواب" }]));
    expect(load).toHaveBeenCalledWith("s7");
    // The restored thread itself is not saved again…
    rerender(base({ restore, exchanges: [{ instruction: "سوال", answer: "جواب" }] }));
    expect(upsert).not.toHaveBeenCalled();
    // …but the next answer goes into the same session and keeps its folder.
    rerender(base({ restore, folderId: "p1", exchanges: [{ instruction: "سوال", answer: "جواب" }, { instruction: "اور", answer: "ہاں" }] }));
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(upsert.mock.calls[0][0]).toMatchObject({ id: "s7", projectId: "p9" });
  });

  it("opens a chat requested from inside the workspace, even after a URL-less mount", async () => {
    const restore = vi.fn();
    const { rerender } = renderHook((a: Args) => useChatPersistence(a), { initialProps: base({ restore }), wrapper: wrapper() });
    expect(load).not.toHaveBeenCalled();
    rerender(base({ restore, sessionRequest: { id: "s7", nonce: 1 } }));
    await waitFor(() => expect(restore).toHaveBeenCalledTimes(1));
    // Asking for the same chat again reloads it.
    rerender(base({ restore, sessionRequest: { id: "s7", nonce: 2 } }));
    await waitFor(() => expect(restore).toHaveBeenCalledTimes(2));
  });

  it("starts a new session on 'new chat'", async () => {
    const reset = vi.fn();
    const { rerender } = renderHook((a: Args) => useChatPersistence(a), {
      initialProps: base({ reset, exchanges: [{ instruction: "ایک", answer: "x" }] }),
      wrapper: wrapper(),
    });
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    act(() => {
      window.dispatchEvent(new CustomEvent(NEW_CHAT_EVENT));
    });
    expect(reset).toHaveBeenCalled();
    rerender(base({ reset, exchanges: [{ instruction: "نیا", answer: "y" }] }));
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(2));
    expect(upsert.mock.calls[1][0]).toMatchObject({ id: null, title: "نیا" });
  });

  it("round-trips the thread through messages", () => {
    const ex = [{ instruction: "a", answer: "b" }, { instruction: "c", answer: "" }];
    expect(messagesToExchanges(exchangesToMessages(ex))).toEqual(ex);
    expect(messagesToExchanges("junk")).toEqual([]);
  });
});
