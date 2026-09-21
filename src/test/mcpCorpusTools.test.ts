// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The MCP `search_islamic_corpus` and `takhrij_hadith` tools.
 *
 * History worth knowing before editing this file: both tools were first written
 * calling `search_documents_smart` with `{ patterns, sub_patterns, max_results }`.
 * The function is `(p_terms, p_source_types, p_match_limit)`, so PostgREST
 * rejected every call and both tools failed on every request. Their tests only
 * covered tool metadata and the unauthenticated refusal, so the suite was green
 * throughout. These tests execute the real happy path against a fake that
 * validates the call against the migration that defines the function.
 */

interface RpcCall { fn: string; args: Record<string, unknown> }
const state: { calls: RpcCall[]; rows: unknown[]; error: { message: string } | null } = {
  calls: [],
  rows: [],
  error: null,
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.calls.push({ fn, args });
      return { data: state.error ? null : state.rows, error: state.error };
    },
  }),
}));

import searchTool from "../lib/mcp/tools/search-islamic-corpus";
import takhrijTool from "../lib/mcp/tools/takhrij-hadith";
import { queryTerms, sourceTypesFor, SEARCH_RPC } from "../lib/mcp/corpusSearch";
import { takhrijHadith, type EngineCitation } from "../../supabase/functions/_shared/citationEngine";

const ctx = { isAuthenticated: () => true, getToken: () => "tok" } as never;
const run = (tool: unknown, input: Record<string, unknown>) => (tool as { handler: (i: unknown, c: unknown) => Promise<any> }).handler(input, ctx);

beforeEach(() => {
  state.calls = [];
  state.rows = [];
  state.error = null;
});

// ─── RPC contract ───────────────────────────────────────────────────────────

/** Parameter names of the LATEST migration that defines search_documents_smart. */
function rpcParamNames(): string[] {
  const dir = path.resolve(__dirname, "../../supabase/migrations");
  const defs = fs.readdirSync(dir).sort()
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
    .filter((sql) => /CREATE OR REPLACE FUNCTION public\.search_documents_smart\s*\(/i.test(sql));
  const sql = defs[defs.length - 1];
  const args = /search_documents_smart\s*\(([\s\S]*?)\)\s*RETURNS/i.exec(sql)![1];
  return [...args.matchAll(/^\s*(p_\w+)\s+/gm)].map((m) => m[1]);
}

describe("MCP corpus RPC contract", () => {
  it("the migration defines the parameters we think it does", () => {
    expect(rpcParamNames()).toEqual(["p_terms", "p_source_types", "p_match_limit"]);
  });

  it.each([
    ["search_islamic_corpus", () => run(searchTool, { query: "الصلاة والزكاة" })],
    ["takhrij_hadith", () => run(takhrijTool, { hadithText: "إنما الأعمال بالنيات" })],
  ])("%s calls %s with ONLY parameters the RPC actually has", async (_name, call) => {
    await call();
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].fn).toBe(SEARCH_RPC);
    const allowed = new Set(rpcParamNames());
    for (const key of Object.keys(state.calls[0].args)) {
      expect(allowed.has(key), `unknown RPC argument "${key}"`).toBe(true);
    }
    // the old, wrong names must be gone
    for (const wrong of ["patterns", "sub_patterns", "max_results"]) {
      expect(state.calls[0].args).not.toHaveProperty(wrong);
    }
  });
});

// ─── query handling ─────────────────────────────────────────────────────────

describe("queryTerms", () => {
  it("splits a multi-word query into separate terms (one whole-sentence pattern matches almost nothing)", () => {
    expect(queryTerms("أحكام الصلاة والزكاة")).toEqual(["أحكام", "الصلاة", "والزكاة"]);
  });

  it("drops stopwords and 1-2 letter tokens, de-duplicates, and caps the count", () => {
    expect(queryTerms("ما هو حكم الصلاة في الصلاة")).toEqual(["حكم", "الصلاة"]);
    expect(queryTerms("a bb ccc ddd eee fff ggg hhh iii jjj").length).toBeLessThanOrEqual(8);
  });

  it("still searches for a short or all-stopword query instead of returning nothing", () => {
    expect(queryTerms("نور")).toEqual(["نور"]);
    expect(queryTerms("في")).toEqual(["في"]);
  });

  it("returns no terms for an empty query", () => {
    expect(queryTerms("   ")).toEqual([]);
  });
});

describe("sourceTypesFor", () => {
  it("maps each domain to the real scholarly_documents.source_type values", () => {
    expect(sourceTypesFor("all")).toBeNull();
    expect(sourceTypesFor("quran")).toEqual(["quran"]);
    expect(sourceTypesFor("hadith")).toEqual(["hadith"]);
    expect(sourceTypesFor("fatwa")).toEqual(["fatwa"]);
    expect(sourceTypesFor("classical")).toEqual(["classical", "tafsir"]);
  });
});

// ─── search_islamic_corpus ──────────────────────────────────────────────────

describe("search_islamic_corpus (executed)", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: "r1", domain: "tanzil", source_type: "quran", content: "text", content_ar: "نص",
    citation_ref: { surah_number: 2, verse: 255 }, language: "ar", source_url: "u", match_score: 2, ...over,
  });

  it("passes the query's words as terms and returns the mapped passages", async () => {
    state.rows = [row()];
    const res = await run(searchTool, { query: "آية الكرسي", limit: 5 });

    expect(state.calls[0].args).toEqual({ p_terms: ["آية", "الكرسي"], p_source_types: null, p_match_limit: 5 });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent.count).toBe(1);
    expect(res.structuredContent.passages[0]).toMatchObject({ id: "r1", source_type: "quran", match_score: 2 });
  });

  it("REGRESSION: the `domain` input is honoured (it was declared but ignored)", async () => {
    await run(searchTool, { query: "الصلاة", domain: "hadith" });
    expect(state.calls[0].args.p_source_types).toEqual(["hadith"]);

    await run(searchTool, { query: "الصلاة", domain: "classical" });
    expect(state.calls[1].args.p_source_types).toEqual(["classical", "tafsir"]);
  });

  it("surfaces an RPC error as a tool error", async () => {
    state.error = { message: "boom" };
    const res = await run(searchTool, { query: "الصلاة" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("boom");
  });

  it("returns an empty list, not an error, when nothing matches", async () => {
    const res = await run(searchTool, { query: "الصلاة" });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent.count).toBe(0);
  });
});

// ─── takhrij_hadith ─────────────────────────────────────────────────────────

const INTENTIONS = "إنما الأعمال بالنيات وإنما لكل امرئ ما نوى فمن كانت هجرته إلى الله ورسوله فهجرته إلى الله ورسوله";
const hadith = (collection: string, n: number, text: string) => ({
  id: `${collection}-${n}`, domain: "hadith-json", source_type: "hadith", content: text, content_ar: text,
  citation_ref: { collection, hadith_number: n, chapter: "باب" }, language: "ar", source_url: "", match_score: 3,
});

describe("takhrij_hadith (executed)", () => {
  it("restricts the query to hadith rows and over-fetches so survivors are not starved", async () => {
    await run(takhrijTool, { hadithText: INTENTIONS, limit: 5 });
    expect(state.calls[0].args.p_source_types).toEqual(["hadith"]);
    expect(state.calls[0].args.p_match_limit).toBe(20); // limit * 4
  });

  it("finds the same narration in other collections and ignores unrelated ones", async () => {
    state.rows = [
      hadith("bukhari", 1, INTENTIONS),
      hadith("muslim", 1907, "إنما الأعمال بالنيات وإنما لكل امرئ ما نوى فمن كانت هجرته إلى دنيا يصيبها أو إلى امرأة ينكحها"),
      hadith("abudawud", 2201, "إنما الأعمال بالنيات وإنما لكل امرئ ما نوى"),
      hadith("tirmidhi", 9, "كان النبي يصوم الاثنين والخميس ويحث على الصدقة والقيام في الليل"),
    ];
    const res = await run(takhrijTool, { hadithText: INTENTIONS });

    expect(res.isError).toBeFalsy();
    const colls = res.structuredContent.crossReferences.map((c: any) => c.collection).sort();
    expect(colls).toEqual(["abudawud", "muslim"]);
    expect(res.structuredContent.primary.collection).toBe("bukhari");
    // strongest agreement first
    const ratios = res.structuredContent.crossReferences.map((c: any) => c.overlap_ratio);
    expect(ratios).toEqual([...ratios].sort((a: number, b: number) => b - a));
  });

  it("never pairs a hadith with another collection's hadith of the same NUMBER", async () => {
    // Bukhari #1 and Muslim #1 are unrelated narrations. Numbering is per-collection.
    state.rows = [
      hadith("bukhari", 1, INTENTIONS),
      hadith("muslim", 1, "كان النبي يصوم الاثنين والخميس ويحث على الصدقة والقيام في الليل"),
    ];
    const res = await run(takhrijTool, { hadithText: INTENTIONS });
    expect(res.structuredContent.crossReferencesCount).toBe(0);
  });

  it("does not list the primary narration as its own cross-reference", async () => {
    state.rows = [hadith("bukhari", 1, INTENTIONS), hadith("bukhari", 1, INTENTIONS)];
    const res = await run(takhrijTool, { hadithText: INTENTIONS });
    expect(res.structuredContent.crossReferencesCount).toBe(0);
  });

  it("reports 'no match' cleanly when the corpus has nothing", async () => {
    const res = await run(takhrijTool, { hadithText: INTENTIONS });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent.crossReferencesCount).toBe(0);
    expect(res.structuredContent.primary).toBeNull();
  });

  it("respects `limit` on the number of cross-references returned", async () => {
    state.rows = [
      hadith("bukhari", 1, INTENTIONS),
      ...Array.from({ length: 6 }, (_, i) => hadith(`coll${i}`, i + 1, INTENTIONS)),
    ];
    const res = await run(takhrijTool, { hadithText: INTENTIONS, limit: 3 });
    expect(res.structuredContent.crossReferences).toHaveLength(3);
  });

  it("surfaces an RPC error as a tool error", async () => {
    state.error = { message: "db down" };
    const res = await run(takhrijTool, { hadithText: INTENTIONS });
    expect(res.isError).toBe(true);
  });

  it("PARITY: matches exactly the narrations the app's takhrijHadith engine finds", async () => {
    // The MCP tool once carried its own tokenizer (different stopwords, `>= 3`
    // instead of `> 3`, threshold 0.4 instead of 0.5), so the same hadith could
    // match in the app and not over MCP. Both now share shared/text/takhrij.ts.
    const rows = [
      hadith("bukhari", 1, INTENTIONS),
      hadith("muslim", 1907, "إنما الأعمال بالنيات وإنما لكل امرئ ما نوى فمن كانت هجرته إلى دنيا يصيبها أو إلى امرأة ينكحها"),
      hadith("abudawud", 2201, "إنما الأعمال بالنيات وإنما لكل امرئ ما نوى"),
      hadith("nasai", 75, "الأعمال بالنيات فمن كانت هجرته إلى الله ورسوله فهجرته إلى الله ورسوله"),
      hadith("tirmidhi", 9, "كان النبي يصوم الاثنين والخميس ويحث على الصدقة والقيام في الليل"),
    ];
    state.rows = rows;
    const mcp = await run(takhrijTool, { hadithText: INTENTIONS, limit: 25 });

    const asCitation = (r: (typeof rows)[number]) =>
      ({ source_type: "hadith", content: r.content, content_ar: r.content_ar, citation_ref: r.citation_ref }) as unknown as EngineCitation;
    const engine = takhrijHadith(asCitation(rows[0]), rows.slice(1).map(asCitation));

    const key = (c: string, n: unknown) => `${c}:${n}`;
    const engineSet = engine.matchingNarrations.map((m) => key(m.collection, m.hadith_number)).sort();
    const mcpSet = mcp.structuredContent.crossReferences.map((m: any) => key(m.collection, m.hadith_number)).sort();
    expect(mcpSet).toEqual(engineSet);
    expect(mcpSet.length).toBeGreaterThan(0);
  });
});
