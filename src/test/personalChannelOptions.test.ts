// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeAll } from "vitest";

/**
 * Search-quality Phase 1 (docs/PHASE0-DIAGNOSIS-URDU.md): one uploaded book
 * appeared in 21 of 23 unrelated live queries because the personal-library
 * channels were too permissive for islamic-search's ten shared slots. The
 * stricter behaviour is opt-in, so findCitations() keeps its old defaults.
 */

vi.stubGlobal("Deno", { env: { get: () => undefined } });
vi.mock("../../supabase/functions/_shared/embed.ts", () => ({
  EMBED_MODEL: "gemini-embedding-001",
  EMBED_DIMS: 768,
  embedQuery: async () => new Array(768).fill(0.01),
  embedBatch: async () => [],
}));

function fakeClient() {
  const rpcArgs: Array<Record<string, unknown>> = [];
  const ilikes: string[] = [];
  const api: Record<string, unknown> = {};
  Object.assign(api, {
    select: () => api,
    eq: () => api,
    ilike: (_col: string, val: string) => { ilikes.push(val); return api; },
    limit: async () => ({ data: [], error: null }),
  });
  return {
    rpcArgs,
    ilikes,
    client: {
      from: () => api,
      rpc: async (_fn: string, args: Record<string, unknown>) => { rpcArgs.push(args); return { data: [], error: null }; },
    },
  };
}

let engine: typeof import("../../supabase/functions/_shared/citationEngine");
beforeAll(async () => { engine = await import("../../supabase/functions/_shared/citationEngine"); });

const plan = {
  intent: "topical" as const,
  scope: { source_types: [], collections: [], surah: null, verse: null, disciplines: [] },
  arabic_surface_forms: [], related_concepts: [], semantic_query_ar: "q", is_proper_noun: false,
};

describe("personal-library channel options", () => {
  it("vector: keeps the permissive 0.35 default, honours minSimilarity", async () => {
    const a = fakeClient();
    await engine.personalVectorChannel(a.client, plan, "q", "u1");
    expect(a.rpcArgs[0].match_threshold).toBe(0.35);

    const b = fakeClient();
    await engine.personalVectorChannel(b.client, plan, "q", "u1", { minSimilarity: 0.6 });
    expect(b.rpcArgs[0].match_threshold).toBe(0.6);
  });

  it("lexical: first term only by default, every term with requireAllTerms", async () => {
    const a = fakeClient();
    await engine.personalLexicalChannel(a.client, "alpha beta gamma", "u1");
    expect(a.ilikes).toEqual(["%alpha%"]);

    const b = fakeClient();
    await engine.personalLexicalChannel(b.client, "alpha beta gamma delta", "u1", { requireAllTerms: true });
    expect(b.ilikes).toEqual(["%alpha%", "%beta%", "%gamma%"]);
  });

  it("islamic-search opts in to the strict behaviour and caps the tier", () => {
    const src = readFileSync("supabase/functions/islamic-search/index.ts", "utf8");
    expect(src).toMatch(/PERSONAL_MIN_SIMILARITY\s*=\s*0\.6/);
    expect(src).toMatch(/PERSONAL_MAX_ROWS\s*=\s*3/);
    expect(src).toContain("{ minSimilarity: PERSONAL_MIN_SIMILARITY }");
    expect(src).toContain("{ requireAllTerms: true }");
    expect(src).toContain("merged.length >= PERSONAL_MAX_ROWS");
  });
});
