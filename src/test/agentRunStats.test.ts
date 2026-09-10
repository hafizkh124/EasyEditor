/**
 * M11 Phase 2 — `deriveRunStats` summarises an agent run from its progress
 * lines only (no IPC change). Pure.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { deriveRunStats, type RunStepLike } from "~shared/agent/runStats";

const step = (kind: string, labelKey?: string, detail?: string): RunStepLike => ({ kind, labelKey, detail });

describe("deriveRunStats", () => {
  it("is all-zero for an empty run", () => {
    expect(deriveRunStats([])).toEqual({ toolsRun: 0, toolsFailed: 0, sourcesRead: 0, steps: 0 });
  });

  it("ignores 'thinking' lines but counts every other step", () => {
    const s = deriveRunStats([step("thinking"), step("tool", "agent.step.read_document"), step("tool-result", "agent.step.read_document"), step("done", "agent.step.done")]);
    expect(s.steps).toBe(3);
  });

  it("counts tool calls and classifies retrieval results as sources", () => {
    const s = deriveRunStats([
      step("tool", "agent.step.search_shamela"),
      step("tool-result", "agent.step.search_shamela"),
      step("tool", "agent.step.insert_footnote"),
      step("tool-result", "agent.step.insert_footnote"),
      step("tool", "agent.step.query_tafseer"),
      step("tool-result", "agent.step.query_tafseer"),
    ]);
    expect(s.toolsRun).toBe(3);
    expect(s.sourcesRead).toBe(2); // shamela + tafsir, not the footnote write
  });

  it("counts failures — a hard error and a tool-result with a detail", () => {
    const s = deriveRunStats([
      step("error", "agent.step.set_page_layout"),
      step("tool", "agent.step.search_shamela"),
      step("tool-result", "agent.step.search_shamela", "connection timed out"),
    ]);
    expect(s.toolsFailed).toBe(2);
    expect(s.sourcesRead).toBe(0); // the failed retrieval does not count as a source
  });
});
