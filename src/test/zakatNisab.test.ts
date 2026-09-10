/**
 * M12 Phase A — nisāb threshold.
 *
 * Ported from `islamic-calculator` `store/utils/nisabUtils.ts` (the pure
 * `calculateNisabThreshold`). The source repo's `nisabCalculations.test.ts`
 * `13648`/`1513` cases test a BUGGY fallback path (`FALLBACK_METAL_PRICES.gold`
 * on a currency-keyed object) that this port deliberately does not carry — so
 * those are replaced by tests of the real 85 g / 612.36 g arithmetic.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { nisabThreshold } from "~shared/zakat/nisab";
import { NISAB, SILVER_NISAB_ALT_GRAMS } from "~shared/zakat/constants";

describe("nisabThreshold", () => {
  it("gold standard = 85 g × gold price", () => {
    const r = nisabThreshold({ goldPricePerGram: 200, silverPricePerGram: 3, standard: "gold" });
    expect(r.threshold).toBeCloseTo(200 * 85);
    expect(r.standardUsed).toBe("gold");
  });

  it("silver standard = 612.36 g × silver price (the Ḥanafī weight)", () => {
    const r = nisabThreshold({ goldPricePerGram: 200, silverPricePerGram: 3, standard: "silver" });
    expect(r.threshold).toBeCloseTo(3 * NISAB.silver.grams);
    expect(r.threshold).toBeCloseTo(3 * 612.36);
  });

  it("'lower' picks whichever threshold is smaller — in practice silver", () => {
    // gold: 200×85 = 17000 ; silver: 3×612.36 = 1837.08
    const r = nisabThreshold({ goldPricePerGram: 200, silverPricePerGram: 3, standard: "lower" });
    expect(r.standardUsed).toBe("silver");
    expect(r.threshold).toBeCloseTo(3 * 612.36);
  });

  it("honours the alternative 595 g silver weight", () => {
    const r = nisabThreshold({
      goldPricePerGram: 200, silverPricePerGram: 3, standard: "silver",
      silverNisabGrams: SILVER_NISAB_ALT_GRAMS,
    });
    expect(r.threshold).toBeCloseTo(3 * 595);
  });

  it("a zero/invalid price yields a zero threshold, not NaN", () => {
    const r = nisabThreshold({ goldPricePerGram: 0, silverPricePerGram: -1, standard: "lower" });
    expect(Number.isFinite(r.threshold)).toBe(true);
    expect(r.threshold).toBe(0);
  });

  it("real PKR-ish figures: silver nisāb ≈ 488,703 at Rs 798/g", () => {
    const r = nisabThreshold({ goldPricePerGram: 46480, silverPricePerGram: 798, standard: "silver" });
    expect(r.threshold).toBeCloseTo(798 * 612.36, 0);
  });
});
