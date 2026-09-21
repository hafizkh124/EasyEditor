import { describe, it, expect, vi, beforeEach } from "vitest";
import { fuseAndRerank, CandidateWithScore } from "../../supabase/functions/_shared/rerank";
import { evaluateKifayatGate, EngineCitation } from "../../supabase/functions/_shared/citationEngine";

describe("fuseAndRerank (ADR 0055 Phase 2c)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("handles empty or single candidate lists gracefully", async () => {
    expect(await fuseAndRerank("query", [])).toEqual([]);
    const single: CandidateWithScore[] = [{ content: "one", score: 0.015 }];
    expect(await fuseAndRerank("query", single)).toEqual(single);
  });

  it("falls back to RRF order when no Cohere API key is provided", async () => {
    const candidates: CandidateWithScore[] = [
      { content: "doc1", score: 0.030 },
      { content: "doc2", score: 0.020 },
      { content: "doc3", score: 0.010 },
    ];

    const result = await fuseAndRerank("query", candidates, { maxResults: 2 });
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("doc1");
    expect(result[1].content).toBe("doc2");
  });

  it("preserves RRF score intact and sets rerank_score (Kifayat Gate Invariant)", async () => {
    const originalScore1 = 0.016; // Low RRF score (1 channel hit)
    const originalScore2 = 0.031; // High RRF score (2 channel hit)

    const candidates: CandidateWithScore[] = [
      { content: "hadith on intention", score: originalScore1 },
      { content: "hadith on charity", score: originalScore2 },
    ];

    // Mock Cohere response prioritizing candidate 0
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { index: 0, relevance_score: 0.95 },
          { index: 1, relevance_score: 0.40 },
        ],
      }),
    });
    globalThis.fetch = mockFetch as any;

    const result = await fuseAndRerank("intention", candidates, {
      cohereApiKey: "test-cohere-key",
      maxResults: 10,
    });

    expect(result).toHaveLength(2);
    // Cohere put doc 0 first
    expect(result[0].content).toBe("hadith on intention");
    expect(result[0].rerank_score).toBe(0.95);
    // CRITICAL: original RRF score must remain untouched!
    expect(result[0].score).toBe(originalScore1);

    expect(result[1].content).toBe("hadith on charity");
    expect(result[1].rerank_score).toBe(0.40);
    expect(result[1].score).toBe(originalScore2);

    // Verify Kifayat Gate evaluates original RRF score, NOT rerank_score
    const gateEval = evaluateKifayatGate(result as unknown as EngineCitation[]);
    // Top RRF score in result is 0.031 -> normalized 0.031 / 0.03278 ≈ 0.95
    expect(gateEval.maxScore).toBeCloseTo(0.031 / 0.03278, 2);
  });

  it("keeps topic anchors pinned at top regardless of reranking scores", async () => {
    const anchor: CandidateWithScore = {
      content: "Surah Al-Baqarah 255 (Ayat al-Kursi)",
      score: 0.005,
      citation_ref: { _is_anchor: true, surah_number: 2, verse: 255 },
    };
    const cand1: CandidateWithScore = { content: "tafsir passage 1", score: 0.020 };
    const cand2: CandidateWithScore = { content: "tafsir passage 2", score: 0.025 };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { index: 1, relevance_score: 0.99 },
          { index: 0, relevance_score: 0.50 },
        ],
      }),
    });
    globalThis.fetch = mockFetch as any;

    const result = await fuseAndRerank("tafsir", [anchor, cand1, cand2], {
      cohereApiKey: "test-cohere-key",
      maxResults: 2,
    });

    // Anchor MUST be at index 0
    expect(result[0].content).toBe(anchor.content);
    expect(result[0].citation_ref?._is_anchor).toBe(true);

    // Followed by top reranked candidate (cand2 had index 1 in pool and score 0.99)
    expect(result[1].content).toBe(cand2.content);
    expect(result[1].rerank_score).toBe(0.99);
  });

  it("gracefully falls back to RRF when Cohere API fails or throws", async () => {
    const candidates: CandidateWithScore[] = [
      { content: "first doc", score: 0.020 },
      { content: "second doc", score: 0.015 },
    ];

    const mockFetch = vi.fn().mockRejectedValue(new Error("Network connection timeout"));
    globalThis.fetch = mockFetch as any;

    const result = await fuseAndRerank("query", candidates, {
      cohereApiKey: "test-key",
      maxResults: 2,
      timeoutMs: 100,
    });

    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("first doc");
    expect(result[1].content).toBe("second doc");
    expect(result[0].rerank_score).toBeUndefined();
  });
});

// ─── Tier starvation regression ─────────────────────────────────────────────
import { fuseByGroup } from "../../supabase/functions/_shared/rerank";

describe("fuseByGroup / no source is starved by tier order", () => {
  // islamic-search concatenates its tiers in a FIXED order (A,B,C,K,D,W,L,T).
  // The first version of the reranker kept the first N of that flat list, so
  // Tier B (up to 15 rows) filled all ten slots and Tier T — Turath, the whole
  // point of the connector — was cut before the model ever saw it.
  type Row = CandidateWithScore & { tier: string };
  const mk = (tier: string, n: number): Row[] =>
    Array.from({ length: n }, (_, i) => ({ content: `${tier}-${i + 1}`, tier }));
  const groupOf = (r: Row) => r.tier;

  it("REGRESSION: a late tier still surfaces when an early tier alone could fill the cap", async () => {
    const flat = [...mk("tierB", 15), ...mk("tierK", 12), ...mk("tierT", 8)];

    const out = await fuseAndRerank("q", flat, { maxResults: 10, groupOf });

    const tiers = new Set(out.map((r) => r.tier));
    expect(tiers.has("tierT")).toBe(true);
    expect(tiers.has("tierK")).toBe(true);
    // The naive "first 10 of the flat list" would have been all tierB:
    expect(flat.slice(0, 10).every((r) => r.tier === "tierB")).toBe(true);
    expect(out.map((r) => r.tier)).not.toEqual(flat.slice(0, 10).map((r) => r.tier));
  });

  it("gives every non-empty tier its best row before any tier gets a second", async () => {
    const flat = [...mk("tierA", 5), ...mk("tierB", 5), ...mk("tierD", 5), ...mk("tierL", 5), ...mk("tierT", 5)];
    const out = await fuseAndRerank("q", flat, { maxResults: 7, groupOf });
    // 5 tiers → the first five are each tier's #1, in tier order
    expect(out.slice(0, 5).map((r) => r.content)).toEqual(["tierA-1", "tierB-1", "tierD-1", "tierL-1", "tierT-1"]);
    expect(out).toHaveLength(7);
  });

  it("preserves each tier's own internal order", async () => {
    const flat = [...mk("tierB", 6), ...mk("tierT", 6)];
    const out = await fuseAndRerank("q", flat, { maxResults: 8, groupOf });
    const b = out.filter((r) => r.tier === "tierB").map((r) => r.content);
    expect(b).toEqual([...b].sort()); // tierB-1, tierB-2, … never reordered within the tier
  });

  it("a tier that returned nothing costs the others nothing", async () => {
    const flat = [...mk("tierB", 12), ...mk("tierK", 12)]; // no D/W/L/T
    const out = await fuseAndRerank("q", flat, { maxResults: 10, groupOf });
    expect(out).toHaveLength(10);
    expect(new Set(out.map((r) => r.tier))).toEqual(new Set(["tierB", "tierK"]));
  });

  it("does not reshuffle when nothing needs cutting", async () => {
    const flat = [...mk("tierB", 3), ...mk("tierT", 3)];
    const out = await fuseAndRerank("q", flat, { maxResults: 10, groupOf });
    expect(out.map((r) => r.content)).toEqual(flat.map((r) => r.content));
  });

  it("is deterministic", async () => {
    const flat = [...mk("tierB", 9), ...mk("tierK", 9), ...mk("tierT", 9)];
    const a = await fuseAndRerank("q", flat, { maxResults: 10, groupOf });
    const b = await fuseAndRerank("q", flat, { maxResults: 10, groupOf });
    expect(a.map((r) => r.content)).toEqual(b.map((r) => r.content));
  });

  it("hands Cohere the FUSED pool, not the raw tier-ordered head", async () => {
    const flat = [...mk("tierB", 30), ...mk("tierT", 30)];
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ index: 0, relevance_score: 0.9 }] }),
    });
    globalThis.fetch = mockFetch as any;

    await fuseAndRerank("q", flat, { cohereApiKey: "k", maxResults: 10, groupOf, poolSize: 20 });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.documents).toHaveLength(20);
    // Raw head would be 20× "tierB-…". Fused head must contain Turath rows.
    expect(body.documents.some((d: string) => d.startsWith("tierT-"))).toBe(true);
  });

  it("never lets pinned anchors crowd out every retrieved result", async () => {
    const anchors: CandidateWithScore[] = Array.from({ length: 12 }, (_, i) => ({
      content: `anchor-${i}`,
      citation_ref: { _is_anchor: true },
    }));
    const flat = [...anchors, ...mk("tierB", 8), ...mk("tierT", 8)];
    const out = await fuseAndRerank("q", flat, { maxResults: 10, groupOf: (r: any) => r.tier ?? "anchor" });
    const retrieved = out.filter((r) => r.citation_ref?._is_anchor !== true);
    expect(retrieved.length).toBeGreaterThanOrEqual(3);
  });

  it("fuseByGroup is a pure stable interleave", () => {
    const out = fuseByGroup(["a1", "a2", "a3", "b1", "b2"], (s) => s[0]);
    expect(out).toEqual(["a1", "b1", "a2", "b2", "a3"]);
  });
});
