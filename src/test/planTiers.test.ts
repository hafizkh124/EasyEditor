// @vitest-environment node
// src/lib/planTiers.ts — the plan/tier data both the Pricing page and the
// PendingApproval page read from, plus the two functions that turn it into
// what a user actually sees: which price for their currency, and translated
// feature labels. A wrong price string or a silently-dropped feature line
// here is a pricing-page bug a real user would hit before anything server-
// side does.
import { describe, it, expect } from "vitest";
import { PLAN_TIERS, priceForCurrency, buildFeatures, type PaidTier } from "../lib/planTiers";
import type { Translator, TranslationKey } from "../lib/i18n";

/** Identity translator: returns the key itself, so composed labels are
 *  predictable without depending on the real translation table's wording. */
const t: Translator = (key: TranslationKey) => key;

describe("PLAN_TIERS — structural invariants", () => {
  it("has exactly the three paid tiers, in ascending order", () => {
    expect(PLAN_TIERS.map((tier) => tier.id)).toEqual<PaidTier[]>(["basic", "pro", "ultra"]);
  });

  it("every tier has a non-empty PKR price and a non-empty USD price", () => {
    for (const tier of PLAN_TIERS) {
      expect(tier.price.length).toBeGreaterThan(0);
      expect(tier.priceUsd.length).toBeGreaterThan(0);
    }
  });

  it("PKR prices strictly increase from basic to ultra", () => {
    const asNumber = (price: string) => Number(price.replace(/[^\d]/g, ""));
    const [basic, pro, ultra] = PLAN_TIERS.map((t) => asNumber(t.price));
    expect(basic).toBeLessThan(pro);
    expect(pro).toBeLessThan(ultra);
  });

  it("USD prices strictly increase from basic to ultra", () => {
    const asNumber = (price: string) => Number(price.replace(/[^\d]/g, ""));
    const [basic, pro, ultra] = PLAN_TIERS.map((t) => asNumber(t.priceUsd));
    expect(basic).toBeLessThan(pro);
    expect(pro).toBeLessThan(ultra);
  });

  it("cardPrice stays equal to priceUsd — the deprecated field must not silently drift", () => {
    for (const tier of PLAN_TIERS) {
      expect(tier.cardPrice).toBe(tier.priceUsd);
    }
  });

  it("only one tier is marked popular", () => {
    expect(PLAN_TIERS.filter((tier) => tier.popular)).toHaveLength(1);
  });

  it("no tier itself is comingSoon, even though individual features within ultra are", () => {
    expect(PLAN_TIERS.every((tier) => tier.comingSoon === false)).toBe(true);
  });

  it("every tier has at least one included feature and at least one not-yet-included feature", () => {
    for (const tier of PLAN_TIERS) {
      expect(tier.featureTemplates.some((f) => f.included)).toBe(true);
      expect(tier.featureTemplates.some((f) => !f.included)).toBe(true);
    }
  });
});

describe("priceForCurrency", () => {
  it("returns the USD price for currency USD", () => {
    const pro = PLAN_TIERS.find((t) => t.id === "pro")!;
    expect(priceForCurrency(pro, "USD")).toBe(pro.priceUsd);
  });

  it("returns the PKR price for currency PKR", () => {
    const pro = PLAN_TIERS.find((t) => t.id === "pro")!;
    expect(priceForCurrency(pro, "PKR")).toBe(pro.price);
  });
});

describe("buildFeatures", () => {
  it("joins qty, translated name, and translated suffix in order", () => {
    const features = buildFeatures(
      [{ qty: "30 min", nameKey: "pricing.stt", suffixKey: "pricing.ocr", included: true }],
      t,
    );
    expect(features[0].label).toBe("30 min pricing.stt pricing.ocr");
  });

  it("omits the suffix entirely when the template has none", () => {
    const features = buildFeatures([{ qty: "", nameKey: "pricing.tts", included: false }], t);
    expect(features[0].label).toBe("pricing.tts");
  });

  it("drops the empty qty rather than leaving a leading space", () => {
    const features = buildFeatures([{ qty: "", nameKey: "pricing.tts", included: false }], t);
    expect(features[0].label.startsWith(" ")).toBe(false);
  });

  it("preserves included and comingSoon flags unchanged", () => {
    const features = buildFeatures(
      [
        { qty: "", nameKey: "pricing.tts", included: false, comingSoon: true },
        { qty: "5", nameKey: "pricing.pages", included: true },
      ],
      t,
    );
    expect(features[0]).toMatchObject({ included: false, comingSoon: true });
    expect(features[1]).toMatchObject({ included: true, comingSoon: undefined });
  });

  it("produces one output entry per input template, in the same order", () => {
    const pro = PLAN_TIERS.find((tier) => tier.id === "pro")!;
    const features = buildFeatures(pro.featureTemplates, t);
    expect(features).toHaveLength(pro.featureTemplates.length);
  });

  it("returns an empty array for an empty template list", () => {
    expect(buildFeatures([], t)).toEqual([]);
  });
});
