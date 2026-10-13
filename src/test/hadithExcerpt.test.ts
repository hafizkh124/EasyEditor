import { describe, it, expect } from "vitest";
import { excerptFields, EXCERPT_MAX } from "~shared/agent/hadithExcerpt";
import { readFileSync } from "node:fs";

describe("hadith excerpt fields (search-quality phase 2.8)", () => {
  it("keeps the Arabic matn and the translation apart, Arabic first in the ledger copy", () => {
    const f = excerptFields({ content: "اردو ترجمہ", content_ar: "كلمتان خفيفتان" });
    expect(f.excerpt).toBe("اردو ترجمہ");
    expect(f.excerpt_ar).toBe("كلمتان خفيفتان");
    expect(f.content).toBe("كلمتان خفيفتان\nاردو ترجمہ");
  });
  it("does not repeat a passage whose content equals its Arabic", () => {
    const f = excerptFields({ content: "نص عربي", content_ar: "نص عربي" });
    expect(f.excerpt).toBeUndefined();
    expect(f.excerpt_ar).toBe("نص عربي");
  });
  it("a row with only `content` (live-API tiers) yields just the excerpt", () => {
    expect(excerptFields({ content: "نص" })).toEqual({ content: "نص", excerpt: "نص" });
    expect(excerptFields({})).toEqual({});
  });
  it("clips long fields", () => {
    const f = excerptFields({ content: "ا".repeat(EXCERPT_MAX + 100) });
    expect(f.excerpt!.length).toBeLessThanOrEqual(EXCERPT_MAX + 1);
  });
  it("both dispatchers use it for search_hadith", () => {
    for (const p of ["src/core/agent/webDispatch.ts", "electron/agent/dispatch.ts"]) {
      const src = readFileSync(p, "utf8");
      expect(src).toContain("excerptFields(c)");
      expect(src).toContain("excerpt_ar");
    }
  });
});
