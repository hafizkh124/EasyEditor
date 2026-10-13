// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { chunkTerms, mergeScoredRows, searchInChunks } from "../../supabase/functions/_shared/chunkedSearch";

describe("chunkTerms", () => {
  it("keeps a short list in one call", () => {
    expect(chunkTerms(["a", "b", "c"])).toEqual([["a", "b", "c"]]);
    expect(chunkTerms([])).toEqual([]);
  });
  it("splits a long list into balanced contiguous chunks, losing and duplicating nothing", () => {
    const terms = Array.from({ length: 10 }, (_, i) => `t${i}`);
    const parts = chunkTerms(terms);
    expect(parts.map((p) => p.length)).toEqual([3, 3, 2, 2]);
    expect(parts.flat()).toEqual(terms);
  });
  it("never makes more chunks than terms", () => {
    expect(chunkTerms(["a", "b", "c", "d"]).length).toBe(4);
  });
});

describe("mergeScoredRows", () => {
  it("adds scores for the same id across chunks and orders by score then id", () => {
    const merged = mergeScoredRows([
      [{ id: "b", match_score: 1 }, { id: "a", match_score: 1 }],
      [{ id: "b", match_score: 2 }, { id: "c", match_score: 1 }],
    ], 10);
    expect(merged.map((r) => [r.id, r.match_score])).toEqual([["b", 3], ["a", 1], ["c", 1]]);
  });
  it("cuts to the limit", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, match_score: 1 }));
    expect(mergeScoredRows([rows], 2)).toHaveLength(2);
  });
});

describe("searchInChunks", () => {
  const rowsFor = (terms: string[]) => terms.map((t) => ({ id: `doc-${t}`, match_score: 1 }));

  it("runs chunks concurrently, not one after another", async () => {
    let inFlight = 0, peak = 0;
    const call = async (terms: string[]) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return { data: rowsFor(terms), error: null };
    };
    const out = await searchInChunks(Array.from({ length: 8 }, (_, i) => `t${i}`), 30, call);
    expect(peak).toBeGreaterThan(1);
    expect(out.chunks).toBe(4);
    expect(out.data).toHaveLength(8);
  });

  it("asks each chunk for more rows than the final limit", async () => {
    const seen: number[] = [];
    await searchInChunks(["a", "b", "c", "d", "e"], 30, async (t, lim) => { seen.push(lim); return { data: rowsFor(t), error: null }; });
    expect(new Set(seen)).toEqual(new Set([60]));
  });

  it("a failed chunk degrades to the others; all failing surfaces the error", async () => {
    const terms = ["a", "b", "c", "d", "e", "f"];
    const partial = await searchInChunks(terms, 30, async (t) =>
      t.includes("a") ? { data: null, error: { message: "boom" } } : { data: rowsFor(t), error: null });
    expect(partial.error).toBeNull();
    expect(partial.data!.length).toBeGreaterThan(0);

    const allBad = await searchInChunks(terms, 30, async () => ({ data: null, error: { code: "57014", message: "timeout" } }));
    expect(allBad.data).toBeNull();
    expect(allBad.error?.code).toBe("57014");
  });

  it("a short list is a single, un-doubled call (same behaviour as before)", async () => {
    const limits: number[] = [];
    const out = await searchInChunks(["a", "b"], 30, async (t, lim) => { limits.push(lim); return { data: rowsFor(t), error: null }; });
    expect(limits).toEqual([30]);
    expect(out.chunks).toBe(1);
  });

  it("islamic-search uses it for both RPCs", () => {
    const src = readFileSync("supabase/functions/islamic-search/index.ts", "utf8");
    expect(src).toContain("searchInChunks<any>(terms, 30");
    expect(src).toContain('supabase.rpc("search_documents_scoped"');
    expect(src).toContain('supabase.rpc("search_documents_smart"');
  });
});
