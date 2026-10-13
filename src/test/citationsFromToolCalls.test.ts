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

describe("citationsFromToolCalls — passage text (search-quality phase 1.2)", () => {
  it("carries the tool's excerpt through as `content`, and omits it when absent", () => {
    const out = citationsFromToolCalls([
      { name: "search_shamela", result: { results: [{ id: "a", reference: "صحيح البخاري ج1 ص5", excerpt: "  إنما الأعمال بالنيات  " }, { id: "b", reference: "مسلم 1907" }] } },
    ]);
    expect(out[0].content).toBe("إنما الأعمال بالنيات");
    expect("content" in out[1]).toBe(false);
  });
});

describe("citationsFromToolCalls — Arabic excerpt (search-quality phase 2.8)", () => {
  it("carries excerpt_ar through as content_ar next to the translation", () => {
    const out = citationsFromToolCalls([
      { name: "search_hadith", result: { results: [{ id: "a", reference: "صحيح البخاري، 6406", excerpt: "ہم سے زہیر نے بیان کیا", excerpt_ar: "كلمتان خفيفتان على اللسان" }] } },
    ]);
    expect(out[0].content).toBe("ہم سے زہیر نے بیان کیا");
    expect(out[0].content_ar).toBe("كلمتان خفيفتان على اللسان");
  });
});
