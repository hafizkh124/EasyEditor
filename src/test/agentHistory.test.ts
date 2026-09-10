/**
 * M11 Phase 1 (ADR-0046) — `buildHistory` shapes finished conversation turns
 * into the `AgentMessage[]` the loop prepends. The load-bearing guarantee is
 * that it NEVER emits a `tool` message (that would 400 strict OpenAI-compat
 * providers — see the module doc).
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { buildHistory, type ConversationTurn } from "~shared/agent/history";

const turn = (instruction: string, answer: string): ConversationTurn => ({ instruction, answer });

describe("buildHistory", () => {
  it("returns [] for an empty conversation (a cold run)", () => {
    expect(buildHistory([])).toEqual([]);
  });

  it("maps a turn to a user message then a model message, in order", () => {
    const out = buildHistory([turn("what does this hadith say?", "It concerns intention.")]);
    expect(out).toEqual([
      { role: "user", text: "what does this hadith say?" },
      { role: "model", text: "It concerns intention." },
    ]);
  });

  it("never emits a `tool` message or a `model` toolCall", () => {
    const out = buildHistory([
      turn("q1", "a1"),
      turn("q2", "a2"),
      turn("q3", "a3"),
    ]);
    expect(out.every((m) => m.role === "user" || m.role === "model")).toBe(true);
    expect(out.every((m) => !("toolCall" in m) || m.role !== "model" || m.text)).toBe(true);
    expect(out.some((m) => m.role === "tool" as unknown)).toBe(false);
  });

  it("keeps the last N turns verbatim and stubs older ones", () => {
    const turns = Array.from({ length: 10 }, (_, i) => turn(`question ${i}`, `answer ${i} `.repeat(500)));
    const out = buildHistory(turns, { keepVerbatim: 2 });
    // 10 turns → 20 messages (a user + a model each).
    expect(out).toHaveLength(20);
    // The oldest answer is stubbed and prefixed.
    const oldestModel = out[1];
    expect(oldestModel.role).toBe("model");
    expect((oldestModel as { text: string }).text.startsWith("(خلاصہ) ")).toBe(true);
    expect((oldestModel as { text: string }).text.length).toBeLessThan(260);
    // The newest answer is (near) verbatim — much longer than a stub.
    const newestModel = out[19];
    expect((newestModel as { text: string }).text.length).toBeGreaterThan(260);
  });

  it("caps a verbatim answer so one long run cannot dominate the window", () => {
    const out = buildHistory([turn("q", "x".repeat(9000))]);
    const model = out[1] as { text: string };
    expect(model.text.length).toBeLessThanOrEqual(1500);
  });

  it("skips a turn that is entirely blank, and collapses whitespace", () => {
    const out = buildHistory([turn("   ", "   "), turn("real\n\n  question", "the\tanswer")]);
    expect(out).toEqual([
      { role: "user", text: "real question" },
      { role: "model", text: "the answer" },
    ]);
  });

  it("emits a user message with no model message when the turn has no answer", () => {
    const out = buildHistory([turn("just a question", "")]);
    expect(out).toEqual([{ role: "user", text: "just a question" }]);
  });
});
