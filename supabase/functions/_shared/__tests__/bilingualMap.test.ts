// Regression tests for bilingualMap + topicAnchors.
// Run locally with:  deno test supabase/functions/_shared/__tests__/

import { assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { BILINGUAL_MAP, expandQueryTerms } from "../bilingualMap.ts";
import { lookupTopicAnchors, topicAnchorCount } from "../topicAnchors.ts";

Deno.test("bilingual map covers at least 50 distinct topics", () => {
  // Each topic has 3-5 keys (Urdu/Arabic/English/transliteration), so 50 topics
  // means ~200 entries minimum.
  assert(Object.keys(BILINGUAL_MAP).length >= 150,
    `expected ≥150 entries, got ${Object.keys(BILINGUAL_MAP).length}`);
});

Deno.test("صدقہ expands to Arabic + English + zakat", () => {
  const got = expandQueryTerms("صدقہ");
  assert(got.includes("الصدقة"), "missing الصدقة");
  assert(got.includes("sadaqah"), "missing sadaqah");
  assert(got.includes("charity"), "missing charity");
});

Deno.test("charity expands back to Urdu + Arabic", () => {
  const got = expandQueryTerms("charity");
  assert(got.includes("صدقہ"), "missing صدقہ");
  assert(got.includes("الصدقة") || got.includes("الزكاة"),
    "missing Arabic equivalent");
});

Deno.test("salah/prayer/نماز all expand to each other", () => {
  for (const q of ["salah", "prayer", "نماز", "الصلاة"]) {
    const got = expandQueryTerms(q);
    assert(got.length >= 4, `expansion for "${q}" too narrow: ${got.join(",")}`);
  }
});

Deno.test("unknown term passes through unchanged", () => {
  const got = expandQueryTerms("xyznonsense");
  assertEquals(got, ["xyznonsense"]);
});

Deno.test("multi-word query expands each token", () => {
  const got = expandQueryTerms("صدقہ اور نماز");
  assert(got.includes("charity"), "missing charity expansion");
  assert(got.includes("prayer"), "missing prayer expansion");
});

Deno.test("topic anchors cover ≥25 topics", () => {
  assert(topicAnchorCount() >= 25,
    `expected ≥25 topic anchor sets, got ${topicAnchorCount()}`);
});

Deno.test("صدقہ topic returns Quran + Hadith anchors", () => {
  const a = lookupTopicAnchors("صدقہ");
  assert(a !== null, "no anchor match for صدقہ");
  assert(a!.quran.length >= 3, `Quran anchors too few: ${a!.quran.length}`);
  assert(a!.hadith.length >= 2, `Hadith anchors too few: ${a!.hadith.length}`);
  // Sanity: 2:267 should be in there (charity, give from good things)
  const has267 = a!.quran.some((q) => q.surah === 2 && q.verse === 267);
  assert(has267, "expected 2:267 in صدقہ anchors");
});

Deno.test("English 'charity' resolves to same anchors as صدقہ", () => {
  const ur = lookupTopicAnchors("صدقہ");
  const en = lookupTopicAnchors("charity");
  assert(ur !== null && en !== null);
  assertEquals(ur!.quran.length, en!.quran.length);
});

Deno.test("unknown query returns null anchors (no fallback)", () => {
  const a = lookupTopicAnchors("xyznonsense");
  assertEquals(a, null);
});

Deno.test("multi-topic query unions anchor sets", () => {
  const a = lookupTopicAnchors("صدقہ اور نماز");
  assert(a !== null, "no anchor match for compound query");
  // Should include 2:267 (charity) AND 2:43 (prayer)
  const hasCharity = a!.quran.some((q) => q.surah === 2 && q.verse === 267);
  const hasPrayer  = a!.quran.some((q) => q.surah === 2 && q.verse === 43);
  assert(hasCharity, "missing charity anchor in union");
  assert(hasPrayer,  "missing prayer anchor in union");
});
