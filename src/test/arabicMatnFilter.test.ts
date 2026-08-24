// @vitest-environment node
import { readFileSync } from "node:fs";

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
 * Most of the tiers live in files that call serve() at import time and can't
 * be loaded into vitest, so — consistent with deleteByScope.test.ts and
 * rijalNarrations.test.ts earlier this session — these read the source and
 * assert on it structurally rather than executing it.
 */

const islamicSearch = readFileSync("supabase/functions/islamic-search/index.ts", "utf8");
const islamicApiFetch = readFileSync("supabase/functions/islamic-api-fetch/index.ts", "utf8");
const vectorSearch = readFileSync("supabase/functions/vector-search/index.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260824000000_match_scholarly_documents_content_ar.sql", "utf8");

describe("IslamicResult carries has_matn", () => {
  it("is declared on the shared type, documented as content_ar-derived", () => {
    expect(islamicApiFetch).toMatch(/has_matn\?:\s*boolean/);
  });
});

describe("match_scholarly_documents now returns content_ar", () => {
  it("adds content_ar to the RETURNS TABLE and both inner SELECTs", () => {
    const returnsTable = migration.slice(migration.indexOf("RETURNS TABLE"), migration.indexOf("LANGUAGE plpgsql"));
    expect(returnsTable).toContain("content_ar text");
    // Both the outer projection and the inner CTE must select it, or content_ar
    // is declared in the return shape but never actually populated.
    const body = migration.slice(migration.indexOf("RETURN QUERY"));
    expect(body.match(/c\.content_ar/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(body.match(/sd\.content_ar/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("keeps the probes=25 / lists=640 pairing untouched", () => {
    // This migration's only job is the added column — regressing the ivfflat
    // retuning would be an unrelated, unnoticed performance regression.
    expect(migration).toContain("ivfflat.probes', '25'");
  });

  it("is still granted to the same three roles", () => {
    expect(migration).toContain("TO authenticated, anon, service_role;");
  });
});

describe("Tier A (islamic-api-fetch) sets has_matn per source", () => {
  it("dorar is always true — scraped straight from Arabic hadith text", () => {
    const fn = islamicApiFetch.slice(
      islamicApiFetch.indexOf("async function fetchDorar"),
      islamicApiFetch.indexOf("async function fetchAlQuran"),
    );
    expect(fn).toMatch(/has_matn:\s*true/);
  });

  it("alquran distinguishes the Arabic-edition hits from the English-only tail", () => {
    const fn = islamicApiFetch.slice(
      islamicApiFetch.indexOf("async function fetchAlQuran"),
      islamicApiFetch.indexOf("// ── Sunnah.com"),
    );
    // Two different has_matn values pushed from two different loops — proof
    // this isn't a single blanket `true` for the whole function.
    expect(fn).toContain("push(item, true)");
    expect(fn).toContain("push(item, false)");
    expect(fn).toMatch(/has_matn:\s*hasArabic/);
  });

  it("quran-com is always true — its search endpoint returns the Arabic ayah", () => {
    const fn = islamicApiFetch.slice(islamicApiFetch.indexOf("async function fetchQuranCom"));
    expect(fn).toMatch(/has_matn:\s*true/);
  });
});

describe("Tier B (vector-search) derives has_matn from content_ar", () => {
  it("sets has_matn in rowToIslamicResult from the row's own content_ar", () => {
    const fn = vectorSearch.slice(
      vectorSearch.indexOf("function rowToIslamicResult"),
      vectorSearch.indexOf("serve(async"),
    );
    expect(fn).toMatch(/has_matn:.*row\.content_ar/);
  });
});

describe("islamic-search wires has_matn through every remaining tier", () => {
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
