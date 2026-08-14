/**
 * Classifies a hadith grading string into one of the four families the app's
 * colour vocabulary already uses (SPEC-UIUX §4.5 / STRATEGY-v1 P2): مصحح
 * (verified/emerald), موثق (authenticated-but-nuanced/amber), ضعیف
 * (weak/orange), مکذوب (forged/red).
 *
 * `grade` is raw free text lifted from the source's own wording (Dorar.net's
 * "خلاصة حكم المحدث" / "درجة الحديث" — see supabase/functions/islamic-api-fetch),
 * not a controlled vocabulary, so this is a best-effort keyword match, not a
 * parser. STRATEGY-v1 risk #1 is overclaiming grading precision: a family
 * this cannot confidently place returns `null` rather than guessing, and the
 * raw text is always shown alongside the chip regardless of the verdict here
 * — the classification only picks a colour, it never replaces the source's
 * own words.
 */
export type HadithGradeFamily = "verified" | "authenticated" | "weak" | "forged";

const FORGED_MARKERS = ["موضوع", "مكذوب", "لا أصل له", "باطل", "منكر"];
const WEAK_MARKERS = ["ضعيف", "شاذ"];
const VERIFIED_MARKERS = ["صحيح"];
const AUTHENTICATED_MARKERS = ["حسن"];

/** Checked in this order on purpose: forged and weak markers can co-occur
 * with "صحيح إسناده" phrasing in compound rulings, and the more severe
 * reading must win so a weak or fabricated hadith never reads as verified. */
export function classifyHadithGrade(grade: string | null | undefined): HadithGradeFamily | null {
  const text = grade?.trim();
  if (!text) return null;
  if (FORGED_MARKERS.some((m) => text.includes(m))) return "forged";
  if (WEAK_MARKERS.some((m) => text.includes(m))) return "weak";
  if (VERIFIED_MARKERS.some((m) => text.includes(m))) return "verified";
  if (AUTHENTICATED_MARKERS.some((m) => text.includes(m))) return "authenticated";
  return null;
}

export const GRADE_FAMILY_STYLE: Record<HadithGradeFamily, { chip: string; label: string }> = {
  verified: { chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20", label: "مصحح" },
  authenticated: { chip: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20", label: "موثق" },
  weak: { chip: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20", label: "ضعیف" },
  forged: { chip: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20", label: "مکذوب" },
};
