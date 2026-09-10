/**
 * M11 Phase 2 (ADR-0049) — `recommendActions` is DETERMINISTIC: the "what
 * next?" chips come from the run's artifacts + tool calls, never the model.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { recommendActions, RECOMMENDATION_PROMPT, type RecommendContext } from "~shared/agent/recommendations";

const ctx = (over: Partial<RecommendContext> = {}): RecommendContext => ({
  artifacts: [],
  toolCalls: [],
  mode: "auto",
  hasProjectFolder: true,
  activeArtifactId: null,
  ...over,
});

const actions = (c: RecommendContext) => recommendActions(c).map((r) => r.action);

describe("recommendActions", () => {
  it("offers nothing for a bare answer with no tools and no artifacts", () => {
    expect(recommendActions(ctx())).toEqual([]);
  });

  it("offers to open an artifact the stage is not already showing", () => {
    expect(actions(ctx({ artifacts: [{ id: "a1", type: "table" }] }))).toContain("open-artifact");
    expect(actions(ctx({ artifacts: [{ id: "a1", type: "table" }], activeArtifactId: "a1" }))).not.toContain("open-artifact");
  });

  it("offers footnotes only after a citable search, in a write mode, with a folder — and not if already footnoted", () => {
    expect(actions(ctx({ toolCalls: [{ name: "search_shamela" }] }))).toContain("insert-footnote");
    expect(actions(ctx({ toolCalls: [{ name: "search_shamela" }], mode: "ask" }))).not.toContain("insert-footnote");
    expect(actions(ctx({ toolCalls: [{ name: "search_shamela" }], hasProjectFolder: false }))).not.toContain("insert-footnote");
    expect(actions(ctx({ toolCalls: [{ name: "search_shamela" }, { name: "insert_footnote" }] }))).not.toContain("insert-footnote");
  });

  it("offers print layout + indexes after drafting a chapter", () => {
    const a = actions(ctx({ toolCalls: [{ name: "draft_section" }] }));
    expect(a).toEqual(expect.arrayContaining(["typeset-print", "build-indexes"]));
  });

  it("offers transcript→chapter after a transcription", () => {
    expect(actions(ctx({ toolCalls: [{ name: "transcribe_media" }] }))).toContain("transcript-to-chapter");
  });

  it("caps at 4 chips", () => {
    const many = ctx({
      artifacts: [{ id: "a1", type: "table" }],
      toolCalls: [{ name: "search_shamela" }, { name: "draft_section" }, { name: "transcribe_media" }, { name: "jkhssn_takhrij" }],
    });
    expect(recommendActions(many).length).toBeLessThanOrEqual(4);
  });

  it("every non-artifact action has a follow-up prompt", () => {
    for (const a of actions(ctx({
      artifacts: [{ id: "a1", type: "sanad-tree" }],
      toolCalls: [{ name: "search_shamela" }, { name: "draft_section" }, { name: "transcribe_media" }, { name: "jkhssn_takhrij" }],
    }))) {
      if (a === "open-artifact") continue;
      expect(RECOMMENDATION_PROMPT[a]).toBeTruthy();
    }
  });
});
