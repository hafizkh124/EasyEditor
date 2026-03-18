import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock Supabase so tests don't need a real database
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  },
}));

import { getRecentActivity, logActivity } from "@/lib/activityLog";

describe("activityLog (localStorage fallback when unauthenticated)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns empty array when no activity exists", async () => {
    const result = await getRecentActivity();
    expect(result).toEqual([]);
  });

  it("logs an activity and retrieves it", async () => {
    await logActivity("tts", "Hello world");
    const entries = await getRecentActivity();
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("tts");
    expect(entries[0].label).toBe("Hello world");
  });

  it("keeps only the last 5 entries", async () => {
    for (let i = 0; i < 7; i++) {
      await logActivity("ocr", `Entry ${i}`);
    }
    const entries = await getRecentActivity();
    expect(entries).toHaveLength(5);
  });

  it("truncates labels longer than 80 characters", async () => {
    const longLabel = "a".repeat(100);
    await logActivity("stt", longLabel);
    const entries = await getRecentActivity();
    expect(entries[0].label).toHaveLength(80);
  });

  it("stores most recent activity first", async () => {
    await logActivity("stt", "First");
    await logActivity("tts", "Second");
    const entries = await getRecentActivity();
    expect(entries[0].label).toBe("Second");
    expect(entries[1].label).toBe("First");
  });

  it("handles corrupt localStorage data gracefully", async () => {
    localStorage.setItem("easyeditor-activity", "not-valid-json{{{");
    const result = await getRecentActivity();
    expect(result).toEqual([]);
  });
});
