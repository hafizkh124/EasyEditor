// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  splitScriptRuns,
  classifyArabicScript,
  isRtlDominant,
  hasRtlChars,
} from "~shared/text/scriptRuns";

describe("classifyArabicScript", () => {
  it("detects Urdu from Urdu-only letters", () => {
    // ہ (U+06C1), ی (U+06CC), ں (U+06BA) do not exist in Arabic
    expect(classifyArabicScript("یہ کتاب بہت اچھی ہے")).toBe("urdu");
    expect(classifyArabicScript("میں نے کہا")).toBe("urdu");
  });

  it("detects Arabic from ta marbuta and Arabic kaf/yeh", () => {
    expect(classifyArabicScript("الكتاب المدرسة")).toBe("arabic");
    expect(classifyArabicScript("في الحديقة")).toBe("arabic");
  });

  it("detects Arabic from tanween even when short", () => {
    expect(classifyArabicScript("شكراً")).toBe("arabic");
  });

  it("detects Arabic from heavy tashkeel", () => {
    expect(classifyArabicScript("إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ")).toBe("arabic");
  });

  it("falls back for genuinely ambiguous runs", () => {
    // "من" carries no distinguishing letters at all — it is valid in both.
    expect(classifyArabicScript("من", "urdu")).toBe("urdu");
    expect(classifyArabicScript("من", "arabic")).toBe("arabic");
  });
});

describe("splitScriptRuns", () => {
  it("returns an empty array for empty input", () => {
    expect(splitScriptRuns("")).toEqual([]);
  });

  it("keeps a single-language sentence as one run", () => {
    const runs = splitScriptRuns("یہ ایک سادہ اردو جملہ ہے");
    expect(runs).toHaveLength(1);
    expect(runs[0].kind).toBe("urdu");
  });

  it("forces guillemet-wrapped text to Arabic (the M4 citation format)", () => {
    // This is the decisive case: an Urdu paragraph quoting a hadith.
    const text = 'نبی کریم نے فرمایا «إنما الأعمال بالنيات» اور یہ اصول بنیادی ہے';
    const runs = splitScriptRuns(text);

    const arabic = runs.filter((r) => r.kind === "arabic");
    expect(arabic).toHaveLength(1);
    expect(arabic[0].text).toContain("إنما الأعمال بالنيات");

    // The Urdu prose on either side must not be swallowed into the quotation.
    const urdu = runs.filter((r) => r.kind === "urdu");
    expect(urdu.length).toBeGreaterThanOrEqual(2);
    expect(urdu[0].text).toContain("فرمایا");
  });

  it("separates Latin from Arabic script", () => {
    const runs = splitScriptRuns("یہ Hello World ہے");
    expect(runs.map((r) => r.kind)).toContain("latin");
    expect(runs.find((r) => r.kind === "latin")?.text.trim()).toBe("Hello World");
  });

  it("offsets reconstruct the original string exactly", () => {
    const text = 'اردو متن «العربية» اور English بھی';
    const runs = splitScriptRuns(text);
    expect(runs.map((r) => r.text).join("")).toBe(text);
    for (const run of runs) {
      expect(text.slice(run.start, run.end)).toBe(run.text);
    }
  });

  it("does not fragment on interior spaces and punctuation", () => {
    // Without neutral-absorption this would split at every space.
    const runs = splitScriptRuns("پہلا لفظ، دوسرا لفظ، تیسرا لفظ۔");
    expect(runs).toHaveLength(1);
  });
});

describe("RTL helpers keep their distinct, pre-existing semantics", () => {
  it("isRtlDominant requires >30% Arabic-script characters", () => {
    expect(isRtlDominant("یہ اردو ہے")).toBe(true);
    expect(isRtlDominant("This is mostly English with one word: کتاب")).toBe(false);
    expect(isRtlDominant("")).toBe(false);
    expect(isRtlDominant("   ")).toBe(false);
  });

  it("hasRtlChars only requires presence in the first 100 chars", () => {
    // The case that distinguishes the two: one Arabic word in English prose.
    expect(hasRtlChars("This is mostly English with one word: کتاب")).toBe(true);
    expect(isRtlDominant("This is mostly English with one word: کتاب")).toBe(false);

    expect(hasRtlChars("Plain English only")).toBe(false);
    expect(hasRtlChars("")).toBe(false);
  });
});
