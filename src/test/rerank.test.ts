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
