// src/core/agent/webModel.ts (M10 Phase 2.1) — the web agent's ModelFn.
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
vi.mock("@/core/ai/aiAdapter", () => ({
  callEdgeFunction: (...args: unknown[]) => invokeMock(...args),
}));

import { webAgentModel, generateWebAgentText } from "@/core/agent/webModel";
import type { AgentTool } from "~shared/agent/types";

beforeEach(() => {
  invokeMock.mockReset();
});

const TOOLS: AgentTool[] = [
  { name: "search_corpus", description: "search", params: { query: { type: "string", description: "q" } }, required: ["query"], effect: "read" },
];

describe("webAgentModel", () => {
  it("posts an already-OpenAI-shaped body to agent-model, with the google/ model id", async () => {
    invokeMock.mockResolvedValue({ data: { role: "assistant", content: "ok" } });
    await webAgentModel([{ role: "user", text: "hi" }], [], "SYS");
    expect(invokeMock).toHaveBeenCalledWith("agent-model", expect.objectContaining({
      model: "google/gemini-2.5-flash",
      messages: expect.arrayContaining([{ role: "system", content: "SYS" }]),
    }));
  });

  it("omits tools/tool_choice from the body when no tools are offered", async () => {
    invokeMock.mockResolvedValue({ data: { role: "assistant", content: "ok" } });
    await webAgentModel([{ role: "user", text: "hi" }], [], "SYS");
    const body = invokeMock.mock.calls[0][1];
    expect(body.tools).toBeUndefined();
  });

  it("attaches tools + tool_choice auto when tools are offered", async () => {
    invokeMock.mockResolvedValue({ data: { role: "assistant", content: "ok" } });
    await webAgentModel([{ role: "user", text: "hi" }], TOOLS, "SYS");
    const body = invokeMock.mock.calls[0][1];
    expect(body.tool_choice).toBe("auto");
    expect(body.tools[0].function.name).toBe("search_corpus");
  });

  it("turns a tool_calls response into a toolCall ModelStep via the shared parser", async () => {
    invokeMock.mockResolvedValue({
      data: { role: "assistant", content: null, tool_calls: [{ id: "call_0", type: "function", function: { name: "search_corpus", arguments: '{"query":"niyyah"}' } }] },
    });
    const step = await webAgentModel([{ role: "user", text: "go" }], TOOLS, "SYS");
    expect(step).toEqual({ kind: "toolCall", name: "search_corpus", args: { query: "niyyah" } });
  });

  it("throws with the edge function's own error message on failure", async () => {
    invokeMock.mockResolvedValue({ data: null, error: { message: "insufficient tokens" } });
    await expect(webAgentModel([{ role: "user", text: "go" }], [], "SYS")).rejects.toThrow(/insufficient tokens/);
  });
});

describe("generateWebAgentText", () => {
  it("sends system+user messages and returns the trimmed content", async () => {
    invokeMock.mockResolvedValue({ data: { role: "assistant", content: "  answer text  " } });
    const out = await generateWebAgentText({ prompt: "p", systemInstruction: "sys" });
    expect(out).toBe("answer text");
    const body = invokeMock.mock.calls[0][1];
    expect(body.messages).toEqual([{ role: "system", content: "sys" }, { role: "user", content: "p" }]);
  });

  it("strips a <think> reasoning block", async () => {
    invokeMock.mockResolvedValue({ data: { role: "assistant", content: "<think>scratch</think>\nfinal answer" } });
    const out = await generateWebAgentText({ prompt: "p" });
    expect(out).toBe("final answer");
  });
});
