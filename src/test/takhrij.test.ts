// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  takhrijTokens,
  takhrijOverlap,
  normalizeArabicForTakhrij,
  TAKHRIJ_MIN_OVERLAP,
  TAKHRIJ_COMMON_WORDS,
} from "../../shared/text/takhrij";
import { normalizeHamzaAndAlif } from "../../supabase/functions/_shared/arabicRoot";

describe("shared takhrij matching", () => {
  it("normalizes exactly like arabicRoot.normalizeHamzaAndAlif (the copy must not drift)", () => {
    // shared/ is bundled into the MCP server, which cannot import the Deno-side
    // arabicRoot module, so the normalization is duplicated. This is the guard.
    const samples = [
      "إنَّمَا الأَعْمَالُ بِالنِّيَّاتِ",
      "مُؤْمِنٌ وَمُؤْمِنَةٌ",
      "الْمَسْؤُولِيَّةُ عَنْ الْفَتْوَى",
      "رَسُولُ اللَّهِ صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ",
      "آمن بالله ٱلرحمن",
      "شَيْءٌ وَيَأْتِي وَلِئَلَّا",
      "",
    ];
    for (const s of samples) {
      expect(normalizeArabicForTakhrij(s)).toBe(normalizeHamzaAndAlif(s));
    }
  });

  it("keeps the app's 0.5 threshold", () => {
    expect(TAKHRIJ_MIN_OVERLAP).toBe(0.5);
  });

  it("drops isnad/matn boilerplate and short tokens", () => {
    const t = takhrijTokens("حدثنا عبد الله قال سمعت رسول الله صلى الله عليه وسلم يقول إنما الأعمال بالنيات");
    for (const boiler of ["حدثنا", "قال", "رسول", "الله", "عليه", "وسلم", "سمعت"]) {
      expect(t.has(boiler)).toBe(false);
    }
    expect(t.has("الاعمال")).toBe(true); // hamza-folded
    expect(t.has("بالنيات")).toBe(true);
    for (const w of t) expect(w.length).toBeGreaterThan(3);
  });

  it("ignores tashkeel when comparing", () => {
    const a = takhrijTokens("إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ");
    const b = takhrijTokens("انما الاعمال بالنيات");
    expect(a).toEqual(b);
  });

  it("normalizes overlap by the SMALLER side, so an abridged narration still matches", () => {
    const full = takhrijTokens("إنما الأعمال بالنيات وإنما لكل امرئ ما نوى فمن كانت هجرته إلى الله ورسوله فهجرته إلى الله ورسوله");
    const abridged = takhrijTokens("إنما الأعمال بالنيات وإنما لكل امرئ ما نوى");
    expect(takhrijOverlap(full, abridged)).toBe(1);
    expect(takhrijOverlap(abridged, full)).toBe(1);
  });

  it("returns null (not 0) when either side has too little content to judge", () => {
    const tiny = takhrijTokens("انما الاعمال");
    const big = takhrijTokens("إنما الأعمال بالنيات وإنما لكل امرئ ما نوى");
    expect(tiny.size).toBeLessThan(3);
    expect(takhrijOverlap(tiny, big)).toBeNull();
    expect(takhrijOverlap(big, tiny)).toBeNull();
  });

  it("gives a low ratio for unrelated narrations", () => {
    const a = takhrijTokens("إنما الأعمال بالنيات وإنما لكل امرئ ما نوى فمن كانت هجرته");
    const b = takhrijTokens("كان النبي يصوم الاثنين والخميس ويحث على الصدقة والقيام في الليل");
    expect(takhrijOverlap(a, b) ?? 0).toBeLessThan(TAKHRIJ_MIN_OVERLAP);
  });

  it("has a real stopword list", () => {
    expect(TAKHRIJ_COMMON_WORDS.size).toBeGreaterThan(20);
  });
});
