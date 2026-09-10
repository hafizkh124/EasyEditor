/**
 * M12 Phase A — the zakat orchestrator.
 *
 * Pins: the 2.5% rate, nisāb gating, net-of-liabilities base (from
 * `islamic-calculator` `store/zakatStore.ts`), the `jewelleryRuling` branch
 * (the M12 fix for the source's self-contradiction), and the mandatory
 * non-fatwā `note` + per-line `dalil`.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { calculateZakat } from "~shared/zakat/calculator";
import type { ZakatInput } from "~shared/zakat/types";

const nisab: ZakatInput["nisab"] = {
  goldPricePerGram: 20000,
  silverPricePerGram: 250, // silver nisāb = 250 × 612.36 = 153,090
  standard: "silver",
};

const base = (over: Partial<ZakatInput> = {}): ZakatInput => ({ hawlMet: true, nisab, ...over });

describe("calculateZakat", () => {
  it("no assets → nothing due, but a note is still returned", () => {
    const r = calculateZakat(base());
    expect(r.zakatDue).toBe(0);
    expect(r.nisabMet).toBe(false);
    expect(r.note).toMatch(/فتویٰ نہیں/);
  });

  it("cash above nisāb → 2.5%", () => {
    const r = calculateZakat(base({ cash: 1_000_000 }));
    expect(r.nisabMet).toBe(true);
    expect(r.netZakatableBase).toBe(1_000_000);
    expect(r.zakatDue).toBe(25_000);
    expect(r.lines[0].dalil).toBeTruthy();
    expect(r.lines[0].ruleRef).toContain("RULES.md");
  });

  it("cash below nisāb → zero due", () => {
    const r = calculateZakat(base({ cash: 100_000 })); // < 153,090
    expect(r.nisabMet).toBe(false);
    expect(r.zakatDue).toBe(0);
  });

  it("hawl not met → assets present but zakatable base is zero", () => {
    const r = calculateZakat(base({ hawlMet: false, cash: 1_000_000 }));
    expect(r.totalZakatableAssets).toBe(0);
    expect(r.zakatDue).toBe(0);
  });

  it("liabilities are netted off; long-term debt only at its annual instalment", () => {
    const r = calculateZakat(base({ cash: 1_000_000, debtsDue: 200_000, longTermDebtAnnual: 50_000 }));
    expect(r.totalLiabilities).toBe(250_000);
    expect(r.netZakatableBase).toBe(750_000);
    expect(r.zakatDue).toBe(18_750);
  });

  it("liabilities cannot drive the base negative", () => {
    const r = calculateZakat(base({ cash: 100_000, debtsDue: 500_000 }));
    expect(r.netZakatableBase).toBe(0);
    expect(r.zakatDue).toBe(0);
  });

  it("jewelleryRuling: 'personal-exempt' exempts everyday-wear gold", () => {
    const r = calculateZakat(base({
      jewelleryRuling: "personal-exempt",
      gold: [{ grams: 100, purity: "24K", use: "regular" }],
      nisab: { ...nisab, goldPricePerGram: 20000 },
    }));
    const goldLine = r.lines.find((l) => l.key === "gold")!;
    expect(goldLine.value).toBe(2_000_000);      // still shown
    expect(goldLine.zakatable).toBe(0);          // but not counted
  });

  it("jewelleryRuling: 'hanafi-all' makes the SAME holding zakatable", () => {
    const r = calculateZakat(base({
      jewelleryRuling: "hanafi-all",
      gold: [{ grams: 100, purity: "24K", use: "regular" }],
    }));
    const goldLine = r.lines.find((l) => l.key === "gold")!;
    expect(goldLine.zakatable).toBe(2_000_000);
    expect(r.zakatDue).toBe(50_000);
    expect(goldLine.dalil).toMatch(/حنفی/);
  });

  it("22K gold is scaled by its purity factor", () => {
    const r = calculateZakat(base({
      jewelleryRuling: "hanafi-all",
      gold: [{ grams: 100, purity: "22K", use: "investment" }],
    }));
    const goldLine = r.lines.find((l) => l.key === "gold")!;
    expect(goldLine.value).toBeCloseTo(100 * 20000 * 0.9167, 0);
  });

  it("reports which nisāb standard actually applied", () => {
    const r = calculateZakat(base({ cash: 1_000_000, nisab: { ...nisab, standard: "gold" } }));
    expect(r.nisabStandardUsed).toBe("gold");
  });
});
