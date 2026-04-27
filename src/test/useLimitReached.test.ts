import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// Mock the subscription context — useLimitReached only reads `subscription`.
let currentSub: Record<string, unknown> | null = null;
vi.mock("@/contexts/SubscriptionContext", () => ({
  useSubscription: () => ({ subscription: currentSub, refetch: () => {}, loading: false }),
}));

import { useLimitReached } from "@/hooks/useLimitReached";

beforeEach(() => {
  currentSub = null;
});

describe("useLimitReached", () => {
  it("returns reached=false and used=0 when subscription has not loaded", () => {
    currentSub = null;
    const { result } = renderHook(() => useLimitReached("research"));
    expect(result.current.used).toBe(0);
    expect(result.current.limit).toBe(0);
    expect(result.current.reached).toBe(false);
    expect(result.current.unavailable).toBe(true);
  });

  it("flags unavailable=true when the tier has no allocation (limit === 0)", () => {
    currentSub = { research_queries_used: 0, research_queries_limit: 0 };
    const { result } = renderHook(() => useLimitReached("research"));
    expect(result.current.unavailable).toBe(true);
    // Critical: zero-limit must NOT count as reached, otherwise the UI would
    // show "limit reached" instead of "feature not in your plan".
    expect(result.current.reached).toBe(false);
  });

  it("flags reached=true once used has caught up to a positive limit", () => {
    currentSub = { research_queries_used: 20, research_queries_limit: 20 };
    const { result } = renderHook(() => useLimitReached("research"));
    expect(result.current.reached).toBe(true);
    expect(result.current.unavailable).toBe(false);
  });

  it("treats over-quota state as reached", () => {
    currentSub = { research_queries_used: 25, research_queries_limit: 20 };
    const { result } = renderHook(() => useLimitReached("research"));
    expect(result.current.reached).toBe(true);
  });

  it("includes optimistic extraUsed in the comparison", () => {
    currentSub = { transcription_seconds_used: 295, transcription_limit: 300 };
    const { result } = renderHook(() => useLimitReached("transcription", 10));
    expect(result.current.used).toBe(305);
    expect(result.current.reached).toBe(true);
  });

  it("maps each QuotaKind to the correct subscription columns", () => {
    currentSub = {
      transcription_seconds_used: 50, transcription_limit: 300,
      tts_characters_used: 1000, tts_character_limit: 5000,
      ocr_pages_used: 3, ocr_pages_limit: 10,
      research_queries_used: 5, research_queries_limit: 20,
      islamic_queries_used: 8, islamic_queries_limit: 10,
    };

    const { result: r1 } = renderHook(() => useLimitReached("transcription"));
    expect(r1.current.used).toBe(50);
    expect(r1.current.limit).toBe(300);

    const { result: r2 } = renderHook(() => useLimitReached("tts"));
    expect(r2.current.used).toBe(1000);
    expect(r2.current.limit).toBe(5000);

    const { result: r3 } = renderHook(() => useLimitReached("ocr"));
    expect(r3.current.used).toBe(3);
    expect(r3.current.limit).toBe(10);

    const { result: r4 } = renderHook(() => useLimitReached("research"));
    expect(r4.current.used).toBe(5);
    expect(r4.current.limit).toBe(20);

    const { result: r5 } = renderHook(() => useLimitReached("islamic"));
    expect(r5.current.used).toBe(8);
    expect(r5.current.limit).toBe(10);
  });
});
