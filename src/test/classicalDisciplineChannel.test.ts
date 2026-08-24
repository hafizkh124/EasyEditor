// @vitest-environment node
import { describe, it, expect, vi, beforeAll } from "vitest";

/**
 * Corpus Atlas finding #4 (2026-08-20): rijal (19,616 rows) and tafsir
 * (6,208 rows) were reachable from NO retrieval path at all, even implicitly.
 * `classicalChannel` only ever called `search_classical_scoped`, which
 * filters on `content_ar IS NOT NULL` — and both disciplines are ingested
 * with `content_ar` deliberately empty (rijal: short Arabic names collide in
 * the dedup index; tafsir: the embedding falls back to `content`). So even a
 * perfectly discipline-detected query returned zero rows for either.
 *
 * The fix adds a semantic half (`match_scholarly_documents`, scoped by
 * discipline's domains and post-filtered on `citation_ref.discipline`) that
 * runs alongside the lexical one. These tests pin the two channels'
 * contracts directly, without going through an LLM.
 */

vi.stubGlobal("Deno", { env: { get: () => undefined } });

vi.mock("../../supabase/functions/_shared/embed.ts", () => ({
  EMBED_MODEL: "gemini-embedding-001",
  EMBED_DIMS: 768,
  embedQuery: async () => new Array(768).fill(0.01),
  embedBatch: async () => [],
}));

type RpcCall = { fn: string; args: Record<string, unknown> };

function makeFakeSupabase(handlers: Record<string, (args: Record<string, unknown>) => unknown[]>) {
  const rpcCalls: RpcCall[] = [];
  return {
    rpcCalls,
    client: {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        const handler = handlers[fn];
        return { data: handler ? handler(args) : [], error: null };
      },
    },
  };
}

let classicalChannel: typeof import("../../supabase/functions/_shared/citationEngine")["classicalChannel"];
let findCitations: typeof import("../../supabase/functions/_shared/citationEngine")["findCitations"];
let fallbackPlan: typeof import("../../supabase/functions/_shared/queryPlanner")["fallbackPlan"];
let disciplineDomains: typeof import("../../supabase/functions/_shared/disciplines")["disciplineDomains"];

beforeAll(async () => {
  ({ classicalChannel, findCitations } = await import("../../supabase/functions/_shared/citationEngine"));
  ({ fallbackPlan } = await import("../../supabase/functions/_shared/queryPlanner"));
  ({ disciplineDomains } = await import("../../supabase/functions/_shared/disciplines"));
});

const rijalRow = {
  id: "r1",
  domain: "islamicurdubooks-rijal",
  source_type: "classical",
  content: "امام بخاری کے استاد کا ترجمہ...",
  content_ar: null,
  citation_ref: { discipline: "rijal", book: "اسماء الرجال", passage_key: "rijal:1" },
  language: "ur",
  passage_key: "rijal:1",
};

const lughatRowWrongDiscipline = {
  id: "l1",
  domain: "islamicurdubooks-rijal", // same domain as above, wrong discipline
  source_type: "classical",
  content: "کسی اور موضوع کا اندراج",
  content_ar: null,
  citation_ref: { discipline: "lughat", book: "کوئی اور کتاب", passage_key: "lughat:1" },
  language: "ur",
  passage_key: "lughat:1",
};

function planFor(query: string) {
  return fallbackPlan(query);
}

describe("classicalChannel", () => {
  it("returns nothing and calls no RPC when no discipline is in scope", async () => {
    const fake = makeFakeSupabase({});
    const plan = planFor("نیت سے متعلق آیات");

    const rows = await classicalChannel(fake.client, plan, {
      source_types: [], collections: [], surah: null, verse: null, disciplines: [],
    });

    expect(rows).toEqual([]);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("finds a rijal row through the semantic channel even though the lexical one returns nothing", async () => {
    const fake = makeFakeSupabase({
      search_classical_scoped: () => [],              // rijal has no content_ar — always empty
      match_scholarly_documents: () => [rijalRow],
    });
    const plan = planFor("راوی کا حال بیان کریں");

    const rows = await classicalChannel(fake.client, plan, {
      source_types: [], collections: [], surah: null, verse: null, disciplines: ["rijal"],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].domain).toBe("islamicurdubooks-rijal");
    expect(rows[0].match_key).toBe("rijal:1");
  });

  it("scopes the semantic RPC to the requested discipline's domains", async () => {
    const fake = makeFakeSupabase({
      search_classical_scoped: () => [],
      match_scholarly_documents: () => [rijalRow],
    });
    const plan = planFor("راوی کا حال");

    await classicalChannel(fake.client, plan, {
      source_types: [], collections: [], surah: null, verse: null, disciplines: ["rijal"],
    });

    const call = fake.rpcCalls.find((c) => c.fn === "match_scholarly_documents");
    expect(call).toBeDefined();
    expect(call!.args.filter_domains).toEqual(disciplineDomains(["rijal"]));
  });

  it("drops a semantic hit whose discipline was not requested, even from a shared domain", async () => {
    // filter_domains is coarser than discipline (a domain filter, not a
    // discipline filter) — the RPC itself can hand back a row from the right
    // domain but the wrong discipline, and that must not leak through.
    const fake = makeFakeSupabase({
      search_classical_scoped: () => [],
      match_scholarly_documents: () => [rijalRow, lughatRowWrongDiscipline],
    });
    const plan = planFor("راوی کا حال");

    const rows = await classicalChannel(fake.client, plan, {
      source_types: [], collections: [], surah: null, verse: null, disciplines: ["rijal"],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].match_key).toBe("rijal:1");
  });

  it("de-dupes a row returned by both the lexical and semantic halves", async () => {
    const bothRow = { ...rijalRow, content_ar: "نص عربي", passage_key: "rijal:1" };
    const fake = makeFakeSupabase({
      search_classical_scoped: () => [bothRow],
      match_scholarly_documents: () => [rijalRow],
    });
    const plan = planFor("راوی کا حال");

    const rows = await classicalChannel(fake.client, plan, {
      source_types: [], collections: [], surah: null, verse: null, disciplines: ["rijal"],
    });

    expect(rows).toHaveLength(1);
  });

  it("never throws when either RPC errors", async () => {
    const fake = {
      client: {
        rpc: async () => ({ data: null, error: { message: "boom" } }),
      },
    };
    const plan = planFor("راوی کا حال");

    await expect(classicalChannel(fake.client, plan, {
      source_types: [], collections: [], surah: null, verse: null, disciplines: ["rijal"],
    })).resolves.toEqual([]);
  });
});

const fatwaRow = {
  id: "f1",
  domain: "urdufatwa",
  source_type: "fatwa",
  content: "سوال: ... جواب: ...",
  content_ar: "",
  citation_ref: { discipline: "fatwa", fatwa_number: "1234", scholar: "مفتی صاحب" },
  language: "ur",
  passage_key: "fatwa:urdufatwa:1234",
};

describe("urdufatwa reachability (Corpus Atlas finding #5)", () => {
  it("queries the urdufatwa domain when the fatwa discipline is in scope", async () => {
    // The bug: DISCIPLINE_DOMAINS.fatwa listed only shamela / openiti /
    // islamqa-cache, so the 22,775-row urdufatwa corpus — fully embedded —
    // was never in filter_domains and no semantic query could ever reach it.
    const fake = makeFakeSupabase({
      search_classical_scoped: () => [],   // urdufatwa's content_ar is empty
      match_scholarly_documents: () => [fatwaRow],
    });
    const plan = planFor("اس مسئلے پر فتویٰ کیا ہے؟");

    const rows = await classicalChannel(fake.client, plan, {
      source_types: [], collections: [], surah: null, verse: null, disciplines: ["fatwa"],
    });

    const call = fake.rpcCalls.find((c) => c.fn === "match_scholarly_documents");
    expect(call!.args.filter_domains).toContain("urdufatwa");
    expect(rows).toHaveLength(1);
    expect(rows[0].domain).toBe("urdufatwa");
  });

  it("finds fatwa rulings semantically even though they have no content_ar", async () => {
    // ingest_fatwa.py writes content_ar: "" — so search_classical_scoped
    // (content_ar-only) can never return a ruling. Before the semantic half
    // existed, a topical fatwa question got nothing back.
    const fake = makeFakeSupabase({
      search_classical_scoped: () => [],
      match_scholarly_documents: () => [fatwaRow],
    });
    const plan = planFor("زکوٰۃ کے بارے میں فتاویٰ");

    const rows = await classicalChannel(fake.client, plan, {
      source_types: [], collections: [], surah: null, verse: null, disciplines: ["fatwa"],
    });

    expect(rows.map((r) => r.match_key)).toEqual(["fatwa:urdufatwa:1234"]);
  });
});

describe("findCitations reaches the classical corpus end to end", () => {
  it("queries both classical RPCs for a rijal-marked question with no explicit scope", async () => {
    const fake = makeFakeSupabase({
      search_classical_scoped: () => [],
      match_scholarly_documents: () => [rijalRow],
    });

    const result = await findCitations({
      query: "اس راوی کا جرح و تعدیل میں کیا حال ہے؟",
      supabase: fake.client,
      rerank: false,
    });

    const fns = fake.rpcCalls.map((c) => c.fn);
    expect(fns).toContain("search_classical_scoped");
    expect(fns).toContain("match_scholarly_documents");
    expect(result.results.some((r) => r.domain === "islamicurdubooks-rijal")).toBe(true);
  });

  it("never scopes to the classical corpus for an ordinary Quran/Hadith question", async () => {
    // The quran/hadith semantic channel also calls match_scholarly_documents,
    // so the RPC name alone can't distinguish the two — what must never
    // happen is a call carrying a classical-only domain like
    // islamicurdubooks-rijal, and search_classical_scoped must not run at all
    // (classicalChannel short-circuits before any RPC when disciplines is []).
    const fake = makeFakeSupabase({});

    await findCitations({ query: "نماز میں خشوع کی اہمیت", supabase: fake.client, rerank: false });

    expect(fake.rpcCalls.map((c) => c.fn)).not.toContain("search_classical_scoped");
    const semanticCalls = fake.rpcCalls.filter((c) => c.fn === "match_scholarly_documents");
    for (const call of semanticCalls) {
      expect(call.args.filter_domains).not.toContain("islamicurdubooks-rijal");
    }
  });
});
