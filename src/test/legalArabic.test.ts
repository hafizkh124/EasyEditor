import { describe, it, expect } from "vitest";
import { getLegalArabicHtml } from "@/lib/legalArabic";
import { PLAN_TIERS } from "@/lib/planTiers";

/** The Arabic pricing page once showed `{tier.id}` and `<Check … />` as literal text. */
describe("Arabic legal pages", () => {
  for (const slug of ["terms", "privacy", "refund", "pricing_info"] as const) {
    it(`${slug} has no leftover JSX or placeholders`, () => {
      const html = getLegalArabicHtml(slug);
      expect(html.length).toBeGreaterThan(500);
      expect(html).not.toMatch(/<[A-Z][A-Za-z]*\b/);
      expect(html).not.toMatch(/\{(tier|f|features)\b/);
      expect(html).not.toContain("<!--");
    });
  }

  it("fills the plan table from the plan list", () => {
    const html = getLegalArabicHtml("pricing_info");
    for (const tier of PLAN_TIERS) {
      expect(html).toContain(tier.priceUsd);
      expect(html).toContain(tier.price);
    }
    expect(html.match(/font-semibold capitalize/g)).toHaveLength(PLAN_TIERS.length);
  });
});
