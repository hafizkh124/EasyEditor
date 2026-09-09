// src/hooks/useWebAgentEngine.ts (M10 Phase 2.1) — the web agent's run
// engine. No IPC exists on web, so plan-approval/cancellation are in-memory
// refs; this pins that they behave the same way electron/agent/planApproval.ts's
// request/resolve pattern does, without the channel.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

let currentWorkspace: { activeDocumentId: string | null; insertIntoCanvas: (html: string) => void } | null = null;
vi.mock("@/core/workspace/WorkspaceContext", () => ({
  useOptionalWorkspace: () => currentWorkspace,
}));

const createWebDispatcherMock = vi.fn();
vi.mock("@/core/agent/webDispatch", () => ({
  createWebDispatcher: (...args: unknown[]) => createWebDispatcherMock(...args),
}));

vi.mock("@/core/agent/webModel", () => ({ webAgentModel: vi.fn() }));

const runAgentLoopMock = vi.fn();
vi.mock("~shared/agent/loop", () => ({ runAgentLoop: (...args: unknown[]) => runAgentLoopMock(...args) }));

const toolsForMock = vi.fn((..._args: unknown[]) => [] as unknown[]);
vi.mock("~shared/agent/toolScoping", () => ({ toolsFor: (...args: unknown[]) => toolsForMock(...args) }));

const buildWebSystemPromptMock = vi.fn((..._args: unknown[]) => "SYSTEM PROMPT");
vi.mock("~shared/agent/systemPrompt", () => ({ buildWebSystemPrompt: (...args: unknown[]) => buildWebSystemPromptMock(...args) }));

// ADR-0038 — stub the intent classifier; its own behaviour is covered by
// agentIntent.test.ts. Here we only care that the engine threads its output in.
vi.mock("~shared/agent/intent", () => ({
  classifyIntent: () => ({ route: { kind: "open" }, ambiguous: false, matchedDomains: [] }),
  negativeConstraintBlock: () => "",
}));

import { useWebAgentEngine } from "@/hooks/useWebAgentEngine";

beforeEach(() => {
  currentWorkspace = { activeDocumentId: "doc-1", insertIntoCanvas: vi.fn() };
  createWebDispatcherMock.mockReset().mockReturnValue({ dispatch: vi.fn(), ledger: { size: 0 } });
  runAgentLoopMock.mockReset().mockResolvedValue({ answer: "ok", messages: [], toolCalls: [], steps: 1, stopReason: "done" });
  toolsForMock.mockClear();
  buildWebSystemPromptMock.mockClear();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useWebAgentEngine — availability", () => {
  it("is available when there is an active document and no desktop agent", () => {
    const { result } = renderHook(() => useWebAgentEngine());
    expect(result.current.available).toBe(true);
  });

  it("is NOT available with no active document", () => {
    currentWorkspace = { activeDocumentId: null, insertIntoCanvas: vi.fn() };
    const { result } = renderHook(() => useWebAgentEngine());
    expect(result.current.available).toBe(false);
  });

  it("is NOT available when window.electronAPI.agent exists (desktop owns the run)", () => {
    (window as unknown as { electronAPI: { agent: object } }).electronAPI = { agent: {} };
    const { result } = renderHook(() => useWebAgentEngine());
    expect(result.current.available).toBe(false);
  });

  it("is NOT available with no workspace context at all", () => {
    currentWorkspace = null;
    const { result } = renderHook(() => useWebAgentEngine());
    expect(result.current.available).toBe(false);
  });
});

describe("useWebAgentEngine — run()", () => {
  it("builds the system prompt and scopes tools for platform:'web'", async () => {
    const { result } = renderHook(() => useWebAgentEngine());
    await act(async () => {
      await result.current.run("مضمون لکھیں", "ask", vi.fn());
    });
    expect(buildWebSystemPromptMock).toHaveBeenCalledWith({ mode: "ask", toolGating: "" });
    expect(toolsForMock).toHaveBeenCalledWith("ask", expect.objectContaining({ platform: "web", ask: "مضمون لکھیں" }));
  });

  it("wires the dispatcher's emitArtifact to forward an 'artifact' progress event", async () => {
    const onProgress = vi.fn();
    const { result } = renderHook(() => useWebAgentEngine());
    await act(async () => {
      await result.current.run("go", "ask", onProgress);
    });
    const session = createWebDispatcherMock.mock.calls[0][0] as { emitArtifact: (ev: unknown) => void };
    session.emitArtifact({ op: "open", artifactId: "x", title: "t", artifactType: "document" });
    expect(onProgress).toHaveBeenCalledWith({ kind: "artifact", artifact: { op: "open", artifactId: "x", title: "t", artifactType: "document" } });
  });

  it("passes the active document id and insertIntoCanvas through to the dispatcher session", async () => {
    const { result } = renderHook(() => useWebAgentEngine());
    await act(async () => {
      await result.current.run("go", "ask", vi.fn());
    });
    const session = createWebDispatcherMock.mock.calls[0][0] as { activeDocumentId: string | null; insertIntoCanvas: unknown };
    expect(session.activeDocumentId).toBe("doc-1");
    expect(session.insertIntoCanvas).toBe(currentWorkspace!.insertIntoCanvas);
  });

  it("does not pass a waitForApproval in ask/auto mode", async () => {
    const { result } = renderHook(() => useWebAgentEngine());
    await act(async () => {
      await result.current.run("go", "auto", vi.fn());
    });
    const opts = runAgentLoopMock.mock.calls[0][4] as { waitForApproval?: unknown };
    expect(opts.waitForApproval).toBeUndefined();
  });
});

describe("useWebAgentEngine — cancel()", () => {
  it("flips isCancelled so a subsequent check reads true", async () => {
    const { result } = renderHook(() => useWebAgentEngine());
    await act(async () => {
      await result.current.run("go", "ask", vi.fn());
    });
    const session = createWebDispatcherMock.mock.calls[0][0] as { isCancelled: () => boolean };
    expect(session.isCancelled()).toBe(false);
    act(() => result.current.cancel());
    expect(session.isCancelled()).toBe(true);
  });
});

describe("useWebAgentEngine — plan approval (in-memory, no IPC)", () => {
  it("emits the plan-open + plan-text progress events, then resolves 'approved' when decidePlan runs", async () => {
    const onProgress = vi.fn();
    const { result } = renderHook(() => useWebAgentEngine());

    let waitForApproval: ((plan: { steps: string[]; summary: string }) => Promise<"approved" | "rejected">) | undefined;
    runAgentLoopMock.mockImplementation(async (_i, _m, _d, _s, opts: { waitForApproval?: typeof waitForApproval }) => {
      waitForApproval = opts.waitForApproval;
      return { answer: "", messages: [], toolCalls: [], steps: 0, stopReason: "done" };
    });

    await act(async () => {
      await result.current.run("go", "plan", onProgress);
    });
    expect(waitForApproval).toBeTruthy();

    let decision: "approved" | "rejected" | undefined;
    const pending = waitForApproval!({ steps: ["step one"], summary: "a plan" }).then((d) => { decision = d; });

    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ kind: "plan-pending", label: expect.any(String) }));
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      kind: "plan-pending",
      artifact: expect.objectContaining({ op: "delta", text: expect.stringContaining("step one") }),
    }));

    act(() => result.current.decidePlan("approved"));
    await pending;
    expect(decision).toBe("approved");
  });

  it("auto-rejects after the approval timeout, without decidePlan ever being called", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWebAgentEngine());
    let waitForApproval: ((plan: { steps: string[]; summary: string }) => Promise<"approved" | "rejected">) | undefined;
    runAgentLoopMock.mockImplementation(async (_i, _m, _d, _s, opts: { waitForApproval?: typeof waitForApproval }) => {
      waitForApproval = opts.waitForApproval;
      return { answer: "", messages: [], toolCalls: [], steps: 0, stopReason: "done" };
    });

    await act(async () => {
      await result.current.run("go", "plan", vi.fn());
    });

    let decision: "approved" | "rejected" | undefined;
    const pending = waitForApproval!({ steps: [], summary: "s" }).then((d) => { decision = d; });
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000 + 100); });
    await pending;
    expect(decision).toBe("rejected");
  });
});
