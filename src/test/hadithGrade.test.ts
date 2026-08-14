import { classifyHadithGrade } from "@/lib/citations/hadithGrade";

/**
 * UX-v1 P5 / STRATEGY-v1 P2 — the classifier that turns Dorar.net's raw
 * grading text into one of the four مصحح/موثق/ضعیف/مکذوب families. Getting
 * the severity ordering wrong here is the one mistake that matters: a hadith
 * graded "منكر" (weak) or "موضوع" (forged) must never render as verified.
 */
describe("classifyHadithGrade", () => {
  it("classifies plain authentic gradings as verified", () => {
    expect(classifyHadithGrade("صحيح")).toBe("verified");
    expect(classifyHadithGrade("إسناده صحيح")).toBe("verified");
  });

  it("classifies hasan gradings as authenticated", () => {
    expect(classifyHadithGrade("حسن")).toBe("authenticated");
    expect(classifyHadithGrade("إسناده حسن")).toBe("authenticated");
  });

  it("classifies weak gradings as weak, even a compound with 'sahih' wording elsewhere", () => {
    expect(classifyHadithGrade("ضعيف")).toBe("weak");
    expect(classifyHadithGrade("ضعيف جدا")).toBe("weak");
    expect(classifyHadithGrade("شاذ")).toBe("weak");
  });

  it("classifies fabricated/forged gradings as forged, taking priority over any other marker", () => {
    expect(classifyHadithGrade("موضوع")).toBe("forged");
    expect(classifyHadithGrade("مكذوب")).toBe("forged");
    expect(classifyHadithGrade("لا أصل له")).toBe("forged");
    expect(classifyHadithGrade("باطل")).toBe("forged");
    // The severe reading wins over any weaker marker that co-occurs in the
    // same free-text ruling.
    expect(classifyHadithGrade("حديث موضوع لا يصح رفعه")).toBe("forged");
  });

  it("returns null rather than guessing on text it cannot confidently place", () => {
    expect(classifyHadithGrade("")).toBeNull();
    expect(classifyHadithGrade(undefined)).toBeNull();
    expect(classifyHadithGrade(null)).toBeNull();
    expect(classifyHadithGrade("رواه الطبراني في الكبير")).toBeNull();
  });
});
