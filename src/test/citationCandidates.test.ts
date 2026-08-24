// @vitest-environment node
// citationCandidates — the retrieval half of the "Add citations" pipeline.
//
// The property that matters: the LLM is only ever shown candidates that
// genuinely exist in scholarly_documents (or, for the API fan-out, that a live
// upstream just returned), never anything invented at this stage — that
// constraint is what the downstream verifier depends on. This file tests the
// orchestration: priority order (topic anchors > FTS > vector > live API,
// since API results are the weakest evidence), dedup by `match_key`, the
// per-claim maxQuran/maxHadith ceiling, and that a row missing the fields a
// citation needs is dropped rather than turned into a broken candidate.
//
// lookupTopicAnchors and planQuery are mocked: the former is a large static
// keyword table (a separate concern from this module's orchestration logic),
// and the latter calls an AI gateway this suite has no business reaching.
// expandQueryTerms is left real — it is pure, already covered by its own
// tests, and mocking it would only obscure what these tests are actually
// asserting.
import { describe, it, expect, beforeEach, vi } from "vitest";
// Side effect: installs `globalThis.Deno` — the module under test reads
// Deno.env.get("SUPABASE_URL") at call time.
import "./helpers/denoShim";
import { createFakeClient } from "./helpers/fakeSupabase";
import { findCitationCandidates } from "../../supabase/functions/_shared/citationCandidates.ts";
import type { TopicAnchorSet } from "../../supabase/functions/_shared/topicAnchors.ts";
import type { QueryPlan } from "../../supabase/functions/_shared/queryPlanner.ts";

const state = vi.hoisted(() => ({
  anchors: null as TopicAnchorSet | null,
  plan: null as QueryPlan | null,
  planThrows: false,
}));

vi.mock("../../supabase/functions/_shared/topicAnchors.ts", () => ({
  lookupTopicAnchors: () => state.anchors,
}));

vi.mock("../../supabase/functions/_shared/queryPlanner.ts", () => ({
  planQuery: async () => {
    if (state.planThrows) throw new Error("AI gateway down");
    return state.plan;
  },
}));

const asClient = (c: unknown) => c as Parameters<typeof findCitationCandidates>[1]["supabase"];

beforeEach(() => {
  state.anchors = null;
  state.plan = null;
  state.planThrows = false;
  vi.restoreAllMocks();
});

const quranRow = (over: Record<string, unknown> = {}) => ({
  source_type: "quran",
  domain: "tanzil",
  content: "translation text",
  content_ar: "نص عربي",
  citation_ref: { surah_number: 2, verse: 267, surah_name: "Al-Baqarah" },
  source_url: "https://quran.example/2/267",
  ...over,
});

const hadithRow = (over: Record<string, unknown> = {}) => ({
  source_type: "hadith",
  domain: "hadith-json",
  content: "translation text",
  content_ar: "نص عربي",
  citation_ref: { book: "sahih-muslim", collection: "Sahih Muslim", hadith_number: "2588" },
  source_url: "https://hadith.example/muslim/2588",
  ...over,
});

/** Blocks fetch by default so vector-search/api-fetch degrade to []. */
function blockFetch() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ results: [] }), { status: 400 }),
  );
}

describe("no candidates anywhere", () => {
  it("returns an empty list without throwing", async () => {
    blockFetch();
    const client = createFakeClient({ rpc: { search_documents_smart: { data: [] } } });
    const result = await findCitationCandidates("a claim about nothing in particular", {
      supabase: asClient(client),
    });
    expect(result).toEqual([]);
  });
});

describe("FTS-only retrieval", () => {
  it("returns a Quran candidate built from the row", async () => {
    blockFetch();
    const client = createFakeClient({
      rpc: {
        search_documents_smart: (args: unknown) => {
          const sourceTypes = (args as { p_source_types: string[] }).p_source_types;
          return { data: sourceTypes.includes("quran") ? [quranRow()] : [] };
        },
      },
    });
    const result = await findCitationCandidates("claim", { supabase: asClient(client) });

    expect(result).toEqual([
      expect.objectContaining({
        type: "quran",
        match_key: "quran:2:267",
        reference: "Qur'an 2:267 (Al-Baqarah)",
        arabic: "نص عربي",
      }),
    ]);
  });

  it("swallows an RPC error as an empty result, not a throw", async () => {
    blockFetch();
    const client = createFakeClient({
      rpc: { search_documents_smart: { error: { message: "statement timeout" } } },
    });
    await expect(
      findCitationCandidates("claim", { supabase: asClient(client) }),
    ).resolves.toEqual([]);
  });

  it("does not call the RPC at all when there are no terms to search for", async () => {
    blockFetch();
    const client = createFakeClient({ rpc: { search_documents_smart: { data: [quranRow()] } } });
    // Every token here is a stopword the shared list drops (see
    // shared/text/stopwords or _shared/stopwords.ts), so expandQueryTerms
    // legitimately returns [] without needing to be mocked for this case.
    await findCitationCandidates("و في من", { supabase: asClient(client) });
    expect(client.rpcCalls.filter((c) => c.name === "search_documents_smart")).toEqual([]);
  });
});

describe("term expansion sources are unioned", () => {
  it("includes planQuery's derived terms alongside expandQueryTerms' output", async () => {
    blockFetch();
    state.plan = {
      intent: "general",
      arabic_surface_forms: ["مصطلح-من-الخطة"],
      related_concepts: ["مفهوم-ذو-صلة"],
    } as unknown as QueryPlan;

    const client = createFakeClient({
      rpc: { search_documents_smart: { data: [] } },
    });
    await findCitationCandidates("claim text", { supabase: asClient(client) });

    const call = client.rpcCalls.find((c) => c.name === "search_documents_smart");
    const terms = (call?.args as { p_terms: string[] }).p_terms;
    expect(terms).toEqual(expect.arrayContaining(["مصطلح-من-الخطة", "مفهوم-ذو-صلة"]));
  });

  it("still retrieves candidates when planQuery throws", async () => {
    blockFetch();
    state.planThrows = true;
    const client = createFakeClient({ rpc: { search_documents_smart: { data: [quranRow()] } } });
    const result = await findCitationCandidates("claim", { supabase: asClient(client) });
    expect(result).toHaveLength(1);
  });
});

describe("topic anchors take priority over FTS", () => {
  it("keeps the anchor's row and drops the FTS duplicate for the same match_key", async () => {
    blockFetch();
    state.anchors = { quran: [{ surah: 2, verse: 267 }], hadith: [] };
    const client = createFakeClient({
      tables: {
        // topicAnchorRows' .eq("source_type","quran") is real-filtered.
        scholarly_documents: [quranRow({ content_ar: "من المرساة" })],
      },
      rpc: {
        // The FTS RPC returns the SAME verse but with different text — if this
        // wins, the dedup-by-priority property is broken.
        search_documents_smart: { data: [quranRow({ content_ar: "من الفهرسة الكاملة للنص" })] },
      },
    });

    const result = await findCitationCandidates("claim", { supabase: asClient(client) });

    expect(result).toHaveLength(1);
    expect(result[0].arabic).toBe("من المرساة");
  });

  it("adds FTS results alongside anchors when the match_keys differ", async () => {
    blockFetch();
    state.anchors = { quran: [{ surah: 2, verse: 267 }], hadith: [] };
    const client = createFakeClient({
      tables: { scholarly_documents: [quranRow()] },
      rpc: {
        search_documents_smart: (args: unknown) => {
          const sourceTypes = (args as { p_source_types: string[] }).p_source_types;
          return {
            data: sourceTypes.includes("quran")
              ? [quranRow({ citation_ref: { surah_number: 18, verse: 10 } })]
              : [],
          };
        },
      },
    });

    const result = await findCitationCandidates("claim", { supabase: asClient(client) });
    expect(result.map((c) => c.match_key).sort()).toEqual(["quran:18:10", "quran:2:267"]);
  });

  it("never invents an anchor row that is not actually in the corpus", async () => {
    // lookupTopicAnchors names a verse, but the DB query for it comes back
    // empty — topicAnchorRows must not fabricate a candidate to fill the gap.
    blockFetch();
    state.anchors = { quran: [{ surah: 99, verse: 1 }], hadith: [] };
    const client = createFakeClient({
      tables: { scholarly_documents: [] },
      rpc: { search_documents_smart: { data: [] } },
    });
    const result = await findCitationCandidates("claim", { supabase: asClient(client) });
    expect(result).toEqual([]);
  });
});

describe("the maxQuran/maxHadith ceiling", () => {
  it("truncates each bucket independently", async () => {
    blockFetch();
    const client = createFakeClient({
      rpc: {
        search_documents_smart: (args: unknown) => {
          const sourceTypes = (args as { p_source_types: string[] }).p_source_types;
          if (sourceTypes.includes("quran")) {
            return {
              data: [1, 2, 3, 4, 5].map((v) =>
                quranRow({ citation_ref: { surah_number: 2, verse: v } }),
              ),
            };
          }
          return {
            data: [1, 2].map((n) =>
              hadithRow({ citation_ref: { book: "sahih-muslim", hadith_number: String(n) } }),
            ),
          };
        },
      },
    });

    const result = await findCitationCandidates("claim", {
      supabase: asClient(client),
      maxQuran: 2,
      maxHadith: 3,
    });

    expect(result.filter((c) => c.type === "quran")).toHaveLength(2);
    expect(result.filter((c) => c.type === "hadith")).toHaveLength(2); // fewer than the cap; unaffected
  });
});

describe("toCandidate — what makes a row usable", () => {
  it("drops a Quran-typed row with no verse number", async () => {
    blockFetch();
    const client = createFakeClient({
      rpc: {
        search_documents_smart: (args: unknown) =>
          (args as { p_source_types: string[] }).p_source_types.includes("quran")
            ? { data: [quranRow({ citation_ref: {} })] }
            : { data: [] },
      },
    });
    const result = await findCitationCandidates("claim", { supabase: asClient(client) });
    expect(result).toEqual([]);
  });

  it("drops a hadith-typed row with no book or hadith number", async () => {
    blockFetch();
    const client = createFakeClient({
      rpc: {
        search_documents_smart: (args: unknown) =>
          (args as { p_source_types: string[] }).p_source_types.includes("hadith")
            ? { data: [hadithRow({ citation_ref: {} })] }
            : { data: [] },
      },
    });
    const result = await findCitationCandidates("claim", { supabase: asClient(client) });
    expect(result).toEqual([]);
  });

  it("drops a row that is neither Quran nor hadith by source_type or domain", async () => {
    blockFetch();
    const client = createFakeClient({
      rpc: {
        search_documents_smart: { data: [{ source_type: "tafsir", domain: "tafsir-ibn-kathir" }] },
      },
    });
    const result = await findCitationCandidates("claim", { supabase: asClient(client) });
    expect(result).toEqual([]);
  });

  it("classifies by domain when source_type is absent", async () => {
    blockFetch();
    const client = createFakeClient({
      rpc: {
        search_documents_smart: (args: unknown) =>
          (args as { p_source_types: string[] }).p_source_types.includes("quran")
            ? { data: [quranRow({ source_type: undefined, domain: "tanzil" })] }
            : { data: [] },
      },
    });
    const result = await findCitationCandidates("claim", { supabase: asClient(client) });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("quran");
  });
});

describe("the live API fan-out", () => {
  it("is skipped entirely when includeApis is false", async () => {
    const fetchSpy = blockFetch();
    const client = createFakeClient({ rpc: { search_documents_smart: { data: [] } } });
    await findCitationCandidates("claim", { supabase: asClient(client), includeApis: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("attempts both vector-search and islamic-api-fetch by default", async () => {
    const fetchSpy = blockFetch();
    const client = createFakeClient({ rpc: { search_documents_smart: { data: [] } } });
    await findCitationCandidates("claim", { supabase: asClient(client) });

    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/functions/v1/vector-search"))).toBe(true);
    expect(urls.some((u) => u.includes("/functions/v1/islamic-api-fetch"))).toBe(true);
  });

  it("ranks a vector hit above an API-only hit when the cap forces a choice", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("vector-search")) {
        return new Response(
          JSON.stringify({ results: [quranRow({ citation_ref: { surah_number: 3, verse: 3 } })] }),
          { status: 200 },
        );
      }
      if (url.includes("islamic-api-fetch")) {
        return new Response(
          JSON.stringify({ results: [quranRow({ citation_ref: { surah_number: 4, verse: 4 } })] }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    });
    const client = createFakeClient({ rpc: { search_documents_smart: { data: [] } } });

    const result = await findCitationCandidates("claim", { supabase: asClient(client), maxQuran: 1 });

    expect(result).toHaveLength(1);
    expect(result[0].match_key).toBe("quran:3:3");
  });

  it("degrades to no API results when the upstream call fails, without throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network unreachable"));
    const client = createFakeClient({ rpc: { search_documents_smart: { data: [quranRow()] } } });
    const result = await findCitationCandidates("claim", { supabase: asClient(client) });
    expect(result).toHaveLength(1); // the FTS hit still comes through
  });
});
