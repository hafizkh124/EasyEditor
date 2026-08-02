import { describe, it, expect } from "vitest";
import { detectTextDirection, effectiveDirection } from "@/lib/reader/direction";

describe("detectTextDirection", () => {
  it("detects Arabic text as RTL", () => {
    expect(detectTextDirection("هذا كتاب في الفقه الإسلامي")).toBe("rtl");
  });

  it("detects Urdu text as RTL", () => {
    expect(detectTextDirection("یہ اردو زبان کی کتاب ہے")).toBe("rtl");
  });

  it("detects English text as LTR", () => {
    expect(detectTextDirection("This is an English book about history.")).toBe("ltr");
  });

  it("ignores HTML markup when deciding", () => {
    const arabicHtml =
      '<span data-type="title" id="toc-2">(القسم الأول)</span>، وفيها أبواب';
    expect(detectTextDirection(arabicHtml)).toBe("rtl");
  });

  it("defaults to RTL for ambiguous/number-only pages", () => {
    expect(detectTextDirection("123456")).toBe("rtl");
    expect(detectTextDirection("")).toBe("rtl");
  });

  it("picks the dominant script in mixed text", () => {
    const mostlyArabic =
      "هذا نص عربي طويل جداً ويتضمن بعض الكلمات اللاتينية مثل Quran و الحديث";
    expect(detectTextDirection(mostlyArabic)).toBe("rtl");
  });

  it("detects Latin-only pages inside a mixed corpus as LTR", () => {
    expect(detectTextDirection("A brief introduction to the Ottoman Empire, written in English.")).toBe("ltr");
  });
});

describe("effectiveDirection", () => {
  it("honours an explicit preference over detection", () => {
    expect(effectiveDirection("ltr", "هذا نص عربي")).toBe("ltr");
    expect(effectiveDirection("rtl", "English text")).toBe("rtl");
  });

  it("falls back to detection for auto", () => {
    expect(effectiveDirection("auto", "This is English.")).toBe("ltr");
    expect(effectiveDirection("auto", "هذا نص عربي")).toBe("rtl");
  });
});
