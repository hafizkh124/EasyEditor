// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { blockNetwork } from "./helpers/denoShim";
import { createFakeClient } from "./helpers/fakeSupabase";

/**
 * Corpus Atlas finding #7: "the corpus's own `language` column can't back an
 * 'Arabic only' toggle... any real Arabic/Urdu split has to check
 * content_ar IS NOT NULL per row instead." (11 of 14 domains are tagged
 * language='ur', including the fully-Arabic easyquran-hadith — the column
 * records the corpus's declared READING language, not what's in the row.)
 *
 * Implementing that needed `has_matn` set correctly on every one of
 * islamic-search's eight result sources — Tier A's three live APIs (each with
 * its own nuance: dorar and Quran.com always have it, alquran only for
 * Arabic-edition matches), Tier B (vector-search), Tier K (local lexical),
 * Tier D (classical), Tier L (personal library), Tier W (word-by-word gloss —
 * always false, it's a translation aid, never matn), and both topic-anchor
 * fetches. A tier that forgets to set it silently defaults to `undefined`,
 * which the filter correctly treats as "exclude" — safe, but it would make
 * that whole tier invisible to a scholar who turned Arabic-only on, with no
 * error anywhere to notice by. These tests are a per-tier regression guard
 * against exactly that: the same shape of mistake as the collections.ts
 * registry step that got dropped earlier this session ([[
 * easyeditor-tohed-arabic-gap-backfill]]) — an easy thing to silently miss
 * when wiring the same field through many places.
 *
 * Tier A (islamic-api-fetch) and Tier B (vector-search) now call the real
 * code — `handle` and `rowToIslamicResult` are both exported (P1's G2 work) —
 * instead of asserting on source text; see TESTING-STRATEGY.md §6.
 *
 * islamic-search's own wiring (Tier K/D/W/L, the topic-anchor fetches, and
 * the filter's position in the pipeline) stays a source-text assertion. That
 * logic is inline inside one 1200-line `handle()` behind an auth wall, a rate
 * limiter, a token-guard deduction and six tiers' worth of RPC/fetch
 * dependencies (islamic-api-fetch and vector-search themselves, called over
 * HTTP, plus classicalChannel, wordByWordChannel, personalVectorChannel,
 * personalLexicalChannel and topicAnchors) — driving it end-to-end would mean
 * building a fake for all of that just to observe one boolean field per tier,
 * which is more likely to hide a real wiring bug behind a wall of mocks than
 * to catch one. The two live-network tiers below (A and B) are exactly the
 * ones with real per-source branching logic worth exercising for real; the
 * rest is "does this one-line literal appear in the right tier's block",
 * which structural source assertions verify honestly.
 */

const migration = readFileSync("supabase/migrations/20260824000000_match_scholarly_documents_content_ar.sql", "utf8");
const islamicSearch = readFileSync("supabase/functions/islamic-search/index.ts", "utf8");

describe("IslamicResult carries has_matn", () => {
  it("is declared on the shared type, documented as content_ar-derived", () => {
    const islamicApiFetch = readFileSync("supabase/functions/islamic-api-fetch/index.ts", "utf8");
    expect(islamicApiFetch).toMatch(/has_matn\?:\s*boolean/);
  });
});

describe("match_scholarly_documents now returns content_ar", () => {
  // The RPC body is SQL, which a unit test cannot execute — this stays a
  // source-text assertion per TESTING-STRATEGY.md §6.
  it("adds content_ar to the RETURNS TABLE and both inner SELECTs", () => {
    const returnsTable = migration.slice(migration.indexOf("RETURNS TABLE"), migration.indexOf("LANGUAGE plpgsql"));
    expect(returnsTable).toContain("content_ar text");
    const body = migration.slice(migration.indexOf("RETURN QUERY"));
    expect(body.match(/c\.content_ar/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(body.match(/sd\.content_ar/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("keeps the probes=25 / lists=640 pairing untouched", () => {
    expect(migration).toContain("ivfflat.probes', '25'");
  });

  it("is still granted to the same three roles", () => {
    expect(migration).toContain("TO authenticated, anon, service_role;");
  });
});

describe("Tier A (islamic-api-fetch) sets has_matn per source — real handle() calls", () => {
  const state = vi.hoisted(() => ({ client: null as unknown }));
  vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
    createClient: () => state.client,
  }));

  type Handler = (req: Request) => Promise<Response>;
  let handle: Handler;
  let restoreNetwork: () => void;
  let originalFetch: typeof fetch;

  const DORAR_HTML =
    '<div class="hadith">1 - إنما الأعمال بالنيات وإنما لكل امرئ ما نوى</div>' +
    '<div class="hadith-info">الراوي: عمر بن الخطاب المحدث: البخاري المصدر: صحيح البخاري الرقم: 1 ' +
    "خلاصة حكم المحدث: صحيح</div>";

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }

  beforeAll(async () => {
    restoreNetwork = blockNetwork();
    ({ handle } = await import("../../supabase/functions/islamic-api-fetch/index.ts"));
  }, 60_000);

  afterAll(() => restoreNetwork?.());

  beforeEach(() => {
    state.client = createFakeClient();
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("dorar.net")) {
        return json({ ahadith: { result: DORAR_HTML } });
      }
      if (url.includes("api.alquran.cloud") && url.endsWith("/ar")) {
        return json({
          data: {
            matches: [
              {
                surah: { number: 2, name: "البقرة", englishName: "Al-Baqarah" },
                numberInSurah: 255,
                juz: 3,
                text: "الله لا إله إلا هو الحي القيوم",
              },
            ],
          },
        });
      }
      if (url.includes("api.alquran.cloud")) {
        // en.sahih edition: 2:255 overlaps the Arabic hit above (proves the
        // has_matn:true branch also merges the English translation in);
        // 2:256 is English-only (proves the has_matn:false branch).
        return json({
          data: {
            matches: [
              { surah: { number: 2 }, numberInSurah: 255, text: "Allah - there is no deity except Him" },
              { surah: { number: 2 }, numberInSurah: 256, text: "There is no compulsion in religion" },
            ],
          },
        });
      }
      if (url.includes("api.quran.com")) {
        return json({
          search: { results: [{ verse_key: "2:255", text: "الله لا إله إلا هو الحي القيوم" }] },
        });
      }
      return json({}, 404);
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function search(selectedDomains: string[]) {
    const res = await handle(
      new Request("https://fn.test/islamic-api-fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "الأعمال بالنيات", selectedDomains }),
      }),
    );
    expect(res.status).toBe(200);
    return (await res.json()).results as Array<{ domain: string; has_matn?: boolean }>;
  }

  it("dorar is always true — scraped straight from Arabic hadith text", async () => {
    const results = await search(["dorar"]);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.domain === "dorar" && r.has_matn === true)).toBe(true);
  });

  it("quran-com is always true — its search endpoint returns the Arabic ayah", async () => {
    const results = await search(["quran-com"]);
    expect(results).toEqual([expect.objectContaining({ domain: "quran-com", has_matn: true })]);
  });

  it("alquran distinguishes the Arabic-edition hit (has_matn: true) from the English-only tail (has_matn: false)", async () => {
    const results = await search(["alquran"]);
    const arabicHit = results.find((r) => r.has_matn === true);
    const englishOnlyHit = results.find((r) => r.has_matn === false);
    expect(arabicHit).toBeDefined();
    expect(englishOnlyHit).toBeDefined();
    expect(results.every((r) => r.domain === "alquran")).toBe(true);
  });
});

describe("Tier B (vector-search) derives has_matn from content_ar — real rowToIslamicResult() calls", () => {
  it("is true when content_ar is a non-blank string", async () => {
    const { rowToIslamicResult } = await import("../../supabase/functions/vector-search/index.ts");
    const row = { domain: "hadith-json", content: "translated text", content_ar: "نص عربي" };
    expect(rowToIslamicResult(row).has_matn).toBe(true);
  });

  it("is false when content_ar is missing, blank, or whitespace-only", async () => {
    const { rowToIslamicResult } = await import("../../supabase/functions/vector-search/index.ts");
    for (const content_ar of [undefined, "", "   "]) {
      const row = { domain: "hadith-json", content: "translated text", content_ar };
      expect(rowToIslamicResult(row).has_matn).toBe(false);
    }
  });
});

describe("islamic-search wires has_matn through every remaining tier", () => {
  // See the file-level comment for why this stays a source-text assertion:
  // exercising it for real means faking the auth wall, rate limiter,
  // token-guard, and six tiers' worth of RPC/fetch dependencies just to
  // observe one boolean literal per tier.
  it("accepts requireArabicMatn on the request", () => {
    expect(islamicSearch).toContain("requireArabicMatn");
    expect(islamicSearch).toMatch(/const \{ query,[\s\S]{0,200}requireArabicMatn/);
  });

  it("Tier K sets has_matn from the RPC row's content_ar", () => {
    const tierK = islamicSearch.slice(
      islamicSearch.indexOf('pushTimed("tierK:local-keyword"'),
      islamicSearch.indexOf('pushTimed("tierD:classical"'),
    );
    expect(tierK).toMatch(/has_matn:.*row\.content_ar/);
  });

  it("Tier D sets has_matn from the classical channel row's content_ar", () => {
    const tierD = islamicSearch.slice(
      islamicSearch.indexOf('pushTimed("tierD:classical"'),
      islamicSearch.indexOf('pushTimed("tierW:word-by-word"'),
    );
    expect(tierD).toMatch(/has_matn:.*row\.content_ar/);
  });

  it("Tier W is hardcoded false — a gloss is never matn", () => {
    const tierW = islamicSearch.slice(
      islamicSearch.indexOf('pushTimed("tierW:word-by-word"'),
      islamicSearch.indexOf('pushTimed("tierL:personal-library"'),
    );
    expect(tierW).toMatch(/has_matn:\s*false/);
  });

  it("Tier L sets has_matn from the personal-library row's content_ar", () => {
    const tierL = islamicSearch.slice(islamicSearch.indexOf('pushTimed("tierL:personal-library"'));
    expect(tierL.slice(0, 2000)).toMatch(/has_matn:.*row\.content_ar/);
  });

  it("both topic-anchor fetches (Quran and Hadith) set has_matn", () => {
    const anchors = islamicSearch.slice(
      islamicSearch.indexOf("if (anchors.quran.length > 0)"),
      islamicSearch.indexOf("const fanOutStart = since();"),
    );
    expect(anchors.match(/has_matn:.*row\.content_ar/g)?.length ?? 0).toBe(2);
  });

  it("filters allResults on has_matn, after the anchor merge and before context-building", () => {
    const dedupeAt = islamicSearch.indexOf("const dedupeStart = since();");
    const anchorBlockAt = islamicSearch.indexOf("if (anchors) {", dedupeAt);
    const filterAt = islamicSearch.indexOf("if (requireArabicMatn === true)");
    const contextAt = islamicSearch.indexOf("buildContextBlock(allResults)");

    expect(dedupeAt).toBeGreaterThan(-1);
    expect(anchorBlockAt).toBeGreaterThan(dedupeAt);
    expect(filterAt).toBeGreaterThan(anchorBlockAt);
    expect(contextAt).toBeGreaterThan(filterAt);

    const filterBlock = islamicSearch.slice(filterAt, filterAt + 300);
    expect(filterBlock).toMatch(/r\.has_matn === true/);
  });
});
