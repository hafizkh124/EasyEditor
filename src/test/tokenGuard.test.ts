// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  TOKEN_ALLOCATIONS,
  calculateCost,
  checkAndDeductTokens,
  refundTokens,
  insufficientTokensResponse,
} from "../../supabase/functions/_shared/tokenGuard";

describe("tokenGuard — Cost calculations", () => {
  it("calculates cost for base units", () => {
    expect(calculateCost("stt", 1)).toBe(10);
    expect(calculateCost("ocr", 1)).toBe(15);
    expect(calculateCost("research", 1)).toBe(30);
    expect(calculateCost("islamic", 1)).toBe(40);
    expect(calculateCost("tts_google", 1)).toBe(50);
    expect(calculateCost("tts_elevenlabs", 1)).toBe(500);
    expect(calculateCost("refine", 1)).toBe(5);
    expect(calculateCost("translate", 1)).toBe(20);
    expect(calculateCost("citation_search", 1)).toBe(5);
  });

  it("rounds up fractional unit quantities", () => {
    // 0.5 minutes of audio -> 1 minute -> 10 tokens
    expect(calculateCost("stt", 0.5)).toBe(10);
    // 2.1 minutes -> 3 minutes -> 30 tokens
    expect(calculateCost("stt", 2.1)).toBe(30);
    // 0 quantity or negative defaults to 1 minimum unit
    expect(calculateCost("stt", 0)).toBe(10);
  });

  it("has expected token allocations for tiers", () => {
    expect(TOKEN_ALLOCATIONS.free).toBe(0);
    expect(TOKEN_ALLOCATIONS.basic).toBe(5000);
    expect(TOKEN_ALLOCATIONS.pro).toBe(25000);
    expect(TOKEN_ALLOCATIONS.ultra).toBe(50000);
  });
});

describe("tokenGuard — Admin check & token deduction mock tests", () => {
  it("bypasses deduction for admin users", async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { role: "admin" } }),
            }),
          }),
        }),
      }),
    };

    const res = await checkAndDeductTokens(mockSupabase, "admin-123", 500, "stt");
    expect(res.ok).toBe(true);
    expect(res.total).toBe(999999);
  });

  it("deducts tokens via RPC for standard users", async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            }),
          }),
        }),
      }),
      rpc: vi.fn().mockResolvedValue({
        data: {
          success: true,
          monthly_balance: 4500,
          topup_balance: 0,
          total: 4500,
        },
        error: null,
      }),
    };

    const res = await checkAndDeductTokens(mockSupabase, "user-456", 500, "stt");
    expect(res.ok).toBe(true);
    expect(res.total).toBe(4500);
  });

  it("handles insufficient tokens result", async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            }),
          }),
        }),
      }),
      rpc: vi.fn().mockResolvedValue({
        data: {
          success: false,
          error: "Insufficient tokens",
          balance: 20,
          required: 50,
        },
        error: null,
      }),
    };

    const res = await checkAndDeductTokens(mockSupabase, "user-789", 50, "tts_google");
    expect(res.ok).toBe(false);
    expect(res.balance).toBe(20);
    expect(res.required).toBe(50);

    const httpResponse = insufficientTokensResponse(res, { "Access-Control-Allow-Origin": "*" });
    expect(httpResponse.status).toBe(402);
  });

  it("credits back tokens on refund", async () => {
    const mockRpc = vi.fn().mockResolvedValue({ error: null });
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            }),
          }),
        }),
      }),
      rpc: mockRpc,
    };

    await refundTokens(mockSupabase, "user-456", 50, "stt", "Failed call");
    expect(mockRpc).toHaveBeenCalledWith("credit_tokens", {
      p_user_id: "user-456",
      p_amount: 50,
      p_source: "monthly",
      p_action_type: "refund",
      p_detail: "Failed call",
    });
  });
});
