import { describe, it, expect } from "vitest";
import { citationsFromToolCalls } from "~shared/agent/citationsFromToolCalls";

describe("citationsFromToolCalls (M11)", () => {
  it("maps search_hadith's results into CitationItem[], keyed to its connector domain", () => {
    const toolCalls = [
      {
        name: "search_hadith",
        args: { query: "نیت" },
        result: {
          count: 1,
          results: [{ id: "hadith:صحيح البخاري:1", reference: "صحيح البخاري 1 (صحيح)", url: "https://x/1" }],
        },
      },
    ];
    const citations = citationsFromToolCalls(toolCalls);
    expect(citations).toEqual([
      { domain: "hadith", citation_ref: { title: "صحيح البخاري 1 (صحيح)" }, url: "https://x/1" },
    ]);
  });

  it("falls back to source_url when url is absent", () => {
    const toolCalls = [
      { name: "search_shamela", args: {}, result: { results: [{ id: "s:1", reference: "كتاب ما", source_url: "https://y/1" }] } },
    ];
    expect(citationsFromToolCalls(toolCalls)).toEqual([
      { domain: "shamela", citation_ref: { title: "كتاب ما" }, url: "https://y/1" },
    ]);
  });

  it("reads research_topic's `sources` field, not `results`", () => {
    const toolCalls = [
      { name: "research_topic", args: { topic: "x" }, result: { sources: [{ id: "c:1", reference: "Some Book, p. 4" }] } },
    ];
    const citations = citationsFromToolCalls(toolCalls);
    expect(citations).toEqual([{ domain: "research_topic", citation_ref: { title: "Some Book, p. 4" }, url: undefined }]);
  });

  it("ignores non-citable tools entirely (e.g. insert_footnote, list_capabilities)", () => {
    const toolCalls = [
      { name: "list_capabilities", args: {}, result: { word: true, summary: "…" } },
      { name: "insert_footnote", args: {}, result: { reference: "should not appear" } },
    ];
    expect(citationsFromToolCalls(toolCalls)).toEqual([]);
  });

  it("skips a citable tool's rows that carry no reference string", () => {
    const toolCalls = [
      { name: "search_corpus", args: {}, result: { count: 1, results: [{ id: "x", excerpt: "…" }] } },
    ];
    expect(citationsFromToolCalls(toolCalls)).toEqual([]);
  });

  it("silently contributes nothing for a card-shaped jkhssn result (no results/sources array)", () => {
    const toolCalls = [
      { name: "jkhssn_narrator", args: {}, result: { count: 2, answer: "…", card: { name: "فلان" } } },
    ];
    expect(citationsFromToolCalls(toolCalls)).toEqual([]);
  });

  it("an error result contributes nothing, without throwing", () => {
    const toolCalls = [{ name: "search_hadith", args: {}, result: { error: "network down" } }];
    expect(citationsFromToolCalls(toolCalls)).toEqual([]);
  });
});
