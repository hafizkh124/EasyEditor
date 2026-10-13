// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { dropQuranRows, isHadithOnlyPlan } from "../../supabase/functions/_shared/sourceScope";

const plan = (source_types: Array<"quran" | "hadith">, degraded = false) => ({
  degraded,
  scope: { source_types, collections: [], surah: null, verse: null, disciplines: [] },
});
const rows = [
  { domain: "tanzil", n: 1 }, { domain: "bukhari", n: 2 }, { domain: "quran-com", n: 3 },
  { domain: "tanzil-urdu", n: 4 }, { domain: "islamicurdubooks-wbw", n: 5 }, { domain: "تفسیر ابن کثیر", n: 6 },
];

describe("source scope (search-quality phase 2)", () => {
  it("a confident hadith-only plan drops every Qur'an row, nothing else", () => {
    expect(dropQuranRows(rows, plan(["hadith"])).map((r) => r.n)).toEqual([2, 6]);
  });

  it("leaves everything alone for both / quran-only / no plan / fallback plan", () => {
    expect(dropQuranRows(rows, plan(["quran", "hadith"]))).toHaveLength(rows.length);
    expect(dropQuranRows(rows, plan(["quran"]))).toHaveLength(rows.length);
    expect(dropQuranRows(rows, null)).toHaveLength(rows.length);
    expect(dropQuranRows(rows, plan(["hadith"], true))).toHaveLength(rows.length);
  });

  it("isHadithOnlyPlan is false for an empty scope", () => {
    expect(isHadithOnlyPlan(plan([]))).toBe(false);
  });

  it("islamic-search applies it to Tier K and to the merged list", () => {
    const src = readFileSync("supabase/functions/islamic-search/index.ts", "utf8");
    expect(src).toContain("wantsQuran && !isHadithOnlyPlan(planForScope)");
    expect(src).toContain("allResults = dropQuranRows(allResults, scopePlan)");
  });
});
