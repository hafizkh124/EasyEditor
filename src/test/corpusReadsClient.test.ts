import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Three reads go through the corpus-reads function now that the browser can no
 * longer read those tables: verse translations for the translation memory,
 * narrator names for the sanad tree, and the admin cache count. A failure
 * leaves them empty, as before.
 */

const invoke = vi.fn();
const from = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) }, from: (...a: unknown[]) => from(...a) },
}));
vi.mock("@/lib/logger", () => ({ logger: { child: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }) } }));

import { lookupTranslationMemory } from "@/lib/translationMemory";
import { resolveNarratorNames, _clearResolveCache } from "@/lib/jkhssn/resolveNames";
import { fetchCacheCount } from "@/lib/admin/corpus-rpc";

beforeEach(() => {
  vi.clearAllMocks();
  _clearResolveCache();
  // The user's own translation history is still read directly (a different table).
  from.mockReturnValue({
    select: () => ({ eq: () => ({ neq: () => ({ eq: () => ({ limit: async () => ({ data: [] }) }) }) }) }),
  });
});

describe("translation memory: verse translations", () => {
  it("reads them through the server", async () => {
    invoke.mockResolvedValue({
      data: { rows: [{ passage_key: "quran:2:255", translator_slug: "jalandhari", text: "اللہ" }] },
      error: null,
    });
    const matches = await lookupTranslationMemory("2:255", "ur");
    expect(invoke).toHaveBeenCalledWith("corpus-reads", {
      body: { action: "passage-translations", passageKey: "quran:2:255", language: "ur" },
    });
    expect(matches).toEqual([
      expect.objectContaining({ translated_text: "اللہ", translator_slug: "jalandhari", match_score: 1, source_type: "passage" }),
    ]);
  });

  it("is empty, not an error, when the server says no", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await lookupTranslationMemory("2:255", "ur")).toEqual([]);
  });

  it("does not call the server for ordinary text", async () => {
    await lookupTranslationMemory("الحمد لله", "ur");
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("narrator names", () => {
  it("resolves ids through the server and caches them", async () => {
    invoke.mockResolvedValue({
      data: { rows: [{ citation_ref: { rawy_id: 7, name_ar: "أبو هريرة", shuhra_ar: "الدوسي" }, source_url: "https://u", title: "t" }] },
      error: null,
    });
    const first = await resolveNarratorNames([7, 7]);
    expect(first.get(7)).toMatchObject({ rawyId: 7, nameAr: "أبو هريرة", shuhraAr: "الدوسي", sourceUrl: "https://u" });
    expect(invoke).toHaveBeenCalledWith("corpus-reads", { body: { action: "narrator-names", rawyIds: [7] } });
    await resolveNarratorNames([7]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("leaves the node without a name when the lookup fails", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await resolveNarratorNames([9])).size).toBe(0);
  });
});

describe("admin cache count", () => {
  it("reads the count through the server", async () => {
    invoke.mockResolvedValue({ data: { count: 42 }, error: null });
    expect(await fetchCacheCount()).toBe(42);
    expect(invoke).toHaveBeenCalledWith("corpus-reads", { body: { action: "cache-count" } });
  });

  it("shows 0 when it is refused", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "Forbidden" } });
    expect(await fetchCacheCount()).toBe(0);
  });
});
