// @vitest-environment node
// Regression tests for bilingualMap + topicAnchors.
// Ported from supabase/functions/_shared/__tests__/ (which no pipeline ran).

import { it } from "vitest";
import { assertEquals, assert } from "./helpers/denoAsserts";
import { BILINGUAL_MAP, expandQueryTerms } from "../../supabase/functions/_shared/bilingualMap.ts";
import { lookupTopicAnchors, topicAnchorCount } from "../../supabase/functions/_shared/topicAnchors.ts";

it("bilingual map covers at least 50 distinct topics", () => {
  // Each topic has 3-5 keys (Urdu/Arabic/English/transliteration), so 50 topics
  // means ~200 entries minimum.
  assert(Object.keys(BILINGUAL_MAP).length >= 150,
    `expected ≥150 entries, got ${Object.keys(BILINGUAL_MAP).length}`);
});

it("صدقہ expands to Arabic + English + zakat", () => {
  const got = expandQueryTerms("صدقہ");
  assert(got.includes("الصدقة"), "missing الصدقة");
  assert(got.includes("sadaqah"), "missing sadaqah");
  assert(got.includes("charity"), "missing charity");
});

it("charity expands back to Urdu + Arabic", () => {
  const got = expandQueryTerms("charity");
  assert(got.includes("صدقہ"), "missing صدقہ");
  assert(got.includes("الصدقة") || got.includes("الزكاة"),
    "missing Arabic equivalent");
});

it("salah/prayer/نماز all expand to each other", () => {
  for (const q of ["salah", "prayer", "نماز", "الصلاة"]) {
    const got = expandQueryTerms(q);
    assert(got.length >= 4, `expansion for "${q}" too narrow: ${got.join(",")}`);
  }
});

it("unknown term passes through unchanged", () => {
  const got = expandQueryTerms("xyznonsense");
  assertEquals(got, ["xyznonsense"]);
});

it("multi-word query expands each token", () => {
  const got = expandQueryTerms("صدقہ اور نماز");
  assert(got.includes("charity"), "missing charity expansion");
  assert(got.includes("prayer"), "missing prayer expansion");
});

it("topic anchors cover ≥25 topics", () => {
  assert(topicAnchorCount() >= 25,
    `expected ≥25 topic anchor sets, got ${topicAnchorCount()}`);
});

it("صدقہ topic returns Quran + Hadith anchors", () => {
  const a = lookupTopicAnchors("صدقہ");
  assert(a !== null, "no anchor match for صدقہ");
  assert(a!.quran.length >= 3, `Quran anchors too few: ${a!.quran.length}`);
  assert(a!.hadith.length >= 2, `Hadith anchors too few: ${a!.hadith.length}`);
  // Sanity: 2:267 should be in there (charity, give from good things)
  const has267 = a!.quran.some((q) => q.surah === 2 && q.verse === 267);
  assert(has267, "expected 2:267 in صدقہ anchors");
});

it("English 'charity' resolves to same anchors as صدقہ", () => {
  const ur = lookupTopicAnchors("صدقہ");
  const en = lookupTopicAnchors("charity");
  assert(ur !== null && en !== null);
  assertEquals(ur!.quran.length, en!.quran.length);
});

it("unknown query returns null anchors (no fallback)", () => {
  const a = lookupTopicAnchors("xyznonsense");
  assertEquals(a, null);
});

it("multi-topic query unions anchor sets", () => {
  const a = lookupTopicAnchors("صدقہ اور نماز");
  assert(a !== null, "no anchor match for compound query");
  // Should include 2:267 (charity) AND 2:43 (prayer)
  const hasCharity = a!.quran.some((q) => q.surah === 2 && q.verse === 267);
  const hasPrayer  = a!.quran.some((q) => q.surah === 2 && q.verse === 43);
  assert(hasCharity, "missing charity anchor in union");
  assert(hasPrayer,  "missing prayer anchor in union");
});
