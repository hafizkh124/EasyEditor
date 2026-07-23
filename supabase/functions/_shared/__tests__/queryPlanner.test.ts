// Tests for the citation engine's query planner.
// Run locally with:  deno test supabase/functions/_shared/__tests__/
//
// Focus: the trust boundary. `coercePlan` is where untrusted LLM output turns
// into arguments for SQL functions, and `fallbackPlan` is what keeps search
// working when the model is unavailable. Neither may ever throw.

import { assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  coercePlan,
  fallbackPlan,
  describeScope,
  COLLECTION_SLUGS,
} from "../queryPlanner.ts";

// ── fallbackPlan: the "model is down" path ──────────────────────────────────

Deno.test("fallbackPlan never throws on empty or junk input", () => {
  for (const q of ["", "   ", "!!!", "؟؟؟", "12345"]) {
    const plan = fallbackPlan(q);
    assert(plan.arabic_surface_forms.length > 0, `empty forms for ${JSON.stringify(q)}`);
    assertEquals(plan.degraded, true);
  }
});

Deno.test("fallbackPlan detects a counting question in Urdu", () => {
  assertEquals(fallbackPlan("قرآن میں موسیٰ کا نام کتنی بار آیا ہے؟").intent, "count");
  assertEquals(fallbackPlan("صحیح بخاری میں قتال کا لفظ کتنی بار آیا ہے؟").intent, "count");
});

Deno.test("fallbackPlan treats a non-counting question as topical", () => {
  assertEquals(fallbackPlan("نیت سے متعلق آیات اور احادیث ذکر کریں").intent, "topical");
});

Deno.test("fallbackPlan picks up an explicitly named collection", () => {
  const plan = fallbackPlan("صحیح بخاری میں قتال کا لفظ کتنی بار آیا ہے؟");
  assert(plan.scope.collections.includes("bukhari"), "expected bukhari in scope");
});

Deno.test("fallbackPlan narrows source_types when only verses are requested", () => {
  const plan = fallbackPlan("صبر سے متعلق آیات بتائیں");
  assertEquals(plan.scope.source_types, ["quran"]);
});

Deno.test("fallbackPlan reuses the bilingual map where it has coverage", () => {
  // نماز IS in BILINGUAL_MAP, so the Arabic equivalent should come through.
  const plan = fallbackPlan("نماز سے متعلق احادیث");
  assert(
    plan.arabic_surface_forms.some((t) => t.includes("صلا") || t.includes("صلاة")),
    `expected an Arabic salah term, got ${JSON.stringify(plan.arabic_surface_forms)}`,
  );
});

// ── coercePlan: the LLM trust boundary ──────────────────────────────────────

Deno.test("coercePlan falls back when the model returns null or a non-object", () => {
  for (const bad of [null, undefined, "a string", 42, []]) {
    const plan = coercePlan(bad, "نیت سے متعلق آیات");
    assert(plan.arabic_surface_forms.length > 0);
  }
});

Deno.test("coercePlan drops collection slugs that are not in the corpus", () => {
  const plan = coercePlan({
    intent: "topical",
    scope: { source_types: ["hadith"], collections: ["bukhari", "not-a-real-book"], surah: null },
    arabic_surface_forms: ["نية"],
    related_concepts: [],
    semantic_query_ar: "النية",
  }, "نیت");
  assertEquals(plan.scope.collections, ["bukhari"]);
});

Deno.test("coercePlan rejects an out-of-range surah", () => {
  for (const surah of [0, 115, -3, 999, "abc"]) {
    const plan = coercePlan({
      intent: "topical",
      scope: { source_types: ["quran"], collections: [], surah },
      arabic_surface_forms: ["نية"],
      semantic_query_ar: "النية",
    }, "نیت");
    assertEquals(plan.scope.surah, null, `surah ${surah} should have been rejected`);
  }
  const ok = coercePlan({
    intent: "topical",
    scope: { source_types: ["quran"], collections: [], surah: 2 },
    arabic_surface_forms: ["نية"],
    semantic_query_ar: "النية",
  }, "نیت");
  assertEquals(ok.scope.surah, 2);
});

Deno.test("coercePlan discards non-Arabic surface forms", () => {
  // The lexical channel searches content_ar, so Latin/Urdu-only tokens can
  // never match there — they must not reach the SQL layer.
  const plan = coercePlan({
    intent: "topical",
    scope: { source_types: ["quran"], collections: [], surah: null },
    arabic_surface_forms: ["نية", "niyyah", "intention", "نيات"],
    semantic_query_ar: "النية",
  }, "نیت");
  assertEquals(plan.arabic_surface_forms, ["نية", "نيات"]);
});

Deno.test("coercePlan falls back to heuristic terms when the model returns none usable", () => {
  const plan = coercePlan({
    intent: "topical",
    scope: { source_types: ["quran"], collections: [], surah: null },
    arabic_surface_forms: ["only-latin", "xyz"],
    semantic_query_ar: "",
  }, "نماز سے متعلق احادیث");
  assert(plan.arabic_surface_forms.length > 0, "must never end up with zero search terms");
});

Deno.test("coercePlan rejects an unknown intent but keeps the rest of the plan", () => {
  const plan = coercePlan({
    intent: "delete_everything",
    scope: { source_types: ["hadith"], collections: ["muslim"], surah: null },
    arabic_surface_forms: ["نية"],
    semantic_query_ar: "النية",
  }, "نیت سے متعلق احادیث");
  assertEquals(plan.intent, "topical");           // fell back to heuristic
  assertEquals(plan.scope.collections, ["muslim"]); // rest survived
});

Deno.test("coercePlan keeps the heuristic collection when the model omits it", () => {
  // The model sometimes drops an explicitly named book; the keyword heuristic
  // is the safety net so "in Sahih Bukhari" is still honoured.
  const plan = coercePlan({
    intent: "count",
    scope: { source_types: ["hadith"], collections: [], surah: null },
    arabic_surface_forms: ["قتال"],
    semantic_query_ar: "القتال",
  }, "صحیح بخاری میں قتال کا لفظ کتنی بار آیا ہے؟");
  assertEquals(plan.scope.collections, ["bukhari"]);
});

Deno.test("coercePlan caps surface forms and related concepts", () => {
  const plan = coercePlan({
    intent: "topical",
    scope: { source_types: ["quran"], collections: [], surah: null },
    arabic_surface_forms: Array(30).fill("نية"),
    related_concepts: Array(30).fill("اخلاص"),
    semantic_query_ar: "النية",
  }, "نیت");
  assert(plan.arabic_surface_forms.length <= 8);
  assert(plan.related_concepts.length <= 4);
});

Deno.test("coercePlan defaults is_proper_noun to false unless explicitly true", () => {
  const base = {
    intent: "count",
    scope: { source_types: ["quran"], collections: [], surah: null },
    arabic_surface_forms: ["موسى"],
    semantic_query_ar: "موسى",
  };
  assertEquals(coercePlan(base, "موسیٰ").is_proper_noun, false);
  assertEquals(coercePlan({ ...base, is_proper_noun: "yes" }, "موسیٰ").is_proper_noun, false);
  assertEquals(coercePlan({ ...base, is_proper_noun: true }, "موسیٰ").is_proper_noun, true);
});

// ── describeScope ───────────────────────────────────────────────────────────

Deno.test("describeScope names the collection when one is scoped", () => {
  const plan = coercePlan({
    intent: "count",
    scope: { source_types: ["hadith"], collections: ["bukhari"], surah: null },
    arabic_surface_forms: ["قتال"],
    semantic_query_ar: "القتال",
  }, "صحیح بخاری میں قتال");
  assertEquals(describeScope(plan), "صحیح بخاری");
});

Deno.test("describeScope falls back to source types when unscoped", () => {
  const plan = coercePlan({
    intent: "topical",
    scope: { source_types: ["quran", "hadith"], collections: [], surah: null },
    arabic_surface_forms: ["نية"],
    semantic_query_ar: "النية",
  }, "نیت");
  assertEquals(describeScope(plan), "قرآن • حدیث");
});

Deno.test("every COLLECTION_SLUG has a display label", () => {
  // Guards against adding a slug to the planner prompt without a UI label,
  // which would surface a raw slug like "shahih-al-jami" to the user.
  for (const slug of COLLECTION_SLUGS) {
    const plan = coercePlan({
      intent: "topical",
      scope: { source_types: ["hadith"], collections: [slug], surah: null },
      arabic_surface_forms: ["نية"],
      semantic_query_ar: "النية",
    }, "نیت");
    const label = describeScope(plan);
    assert(label !== slug, `slug ${slug} has no display label`);
  }
});
