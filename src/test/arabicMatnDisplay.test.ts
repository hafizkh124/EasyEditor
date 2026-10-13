// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { rowToIslamicResult } from "../../supabase/functions/vector-search/index";

describe("Arabic matn reaches the client (search-quality phase 2.6)", () => {
  it("vector-search keeps content_ar when the row has it and omits it otherwise", () => {
    const withAr = rowToIslamicResult({ domain: "hadith-json", content: "اردو", content_ar: "كلمتان", citation_ref: {} });
    expect(withAr.content_ar).toBe("كلمتان");
    expect(withAr.has_matn).toBe(true);
    const without = rowToIslamicResult({ domain: "urdu-hadith", content: "اردو", content_ar: null, citation_ref: {} });
    expect(without.content_ar).toBeUndefined();
    expect(without.has_matn).toBe(false);
    expect(rowToIslamicResult({ domain: "x", content: "y", content_ar: "   ", citation_ref: {} }).content_ar).toBeUndefined();
  });

  it("islamic-search sends content_ar in sources_ready and sets it on every tier that has has_matn", () => {
    const src = readFileSync("supabase/functions/islamic-search/index.ts", "utf8");
    expect(src).toContain("content_ar:   passageForClient(r.content_ar)");
    const hasMatn = src.match(/has_matn: typeof row\.content_ar/g) ?? [];
    const setAr = src.match(/content_ar: typeof row\.content_ar === "string"/g) ?? [];
    expect(hasMatn.length).toBeGreaterThan(0);
    expect(setAr.length).toBe(hasMatn.length); // no tier sets has_matn without also passing the text on
  });
});

describe("same-hadith grouping is wired into islamic-search (search-quality phase 2.7)", () => {
  it("runs after the hadith-only filter and before rerank, and the model sees the Arabic too", () => {
    const src = readFileSync("supabase/functions/islamic-search/index.ts", "utf8");
    const filter = src.indexOf("allResults = dropQuranRows(allResults, scopePlan)");
    const group = src.indexOf("allResults = groupWitnesses(allResults)");
    const rerank = src.indexOf("allResults = await fuseAndRerank(");
    expect(filter).toBeGreaterThan(0);
    expect(group).toBeGreaterThan(filter);
    expect(rerank).toBeGreaterThan(group);
    expect(src).toContain("r.content_ar && r.content_ar !== r.content");
  });
});
