import { describe, it, expect } from "vitest";
import { countUncertain, splitPages, splitUncertain } from "@/lib/extract/uncertain";

describe("uncertain OCR words", () => {
  it("marks the word before [?], and a bare [?]", () => {
    expect(splitUncertain("قال الشيخ[?] رحمه [?]\n[?] الله")).toEqual([
      { text: "قال ", uncertain: false },
      { text: "الشيخ", uncertain: true },
      { text: " ", uncertain: false },
      { text: "رحمه", uncertain: true },
      { text: "\n", uncertain: false },
      { text: "؟", uncertain: true },
      { text: " الله", uncertain: false },
    ]);
    expect(splitUncertain("صاف متن")).toEqual([{ text: "صاف متن", uncertain: false }]);
    expect(countUncertain("a[?] b [?]")).toBe(2);
  });

  it("splits a result back into pages by its markers", () => {
    expect(splitPages("--- صفحہ 1 ---\nپہلا\n\n--- صفحہ 2 ---\nدوسرا")).toEqual([
      { pageNum: 1, text: "پہلا" },
      { pageNum: 2, text: "دوسرا" },
    ]);
    expect(splitPages("--- Page 3 ---\nthree")).toEqual([{ pageNum: 3, text: "three" }]);
    expect(splitPages("  no markers ")).toEqual([{ pageNum: 1, text: "no markers" }]);
  });
});
