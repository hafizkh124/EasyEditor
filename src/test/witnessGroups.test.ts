// @vitest-environment node
import { describe, it, expect } from "vitest";
import { bookIdOf, looksArabic, arabicOverlap, groupWitnesses } from "../../supabase/functions/_shared/witnessGroups";

const MATN = "كلمتان خفيفتان على اللسان ثقيلتان في الميزان حبيبتان إلى الرحمن سبحان الله وبحمده سبحان الله العظيم";
const ISNAD = "حدثنا زهير بن حرب حدثنا ابن فضيل عن عمارة عن ابي زرعة عن ابي هريرة قال قال رسول الله صلى الله عليه وسلم " + MATN;
const URDU = "ہم سے زہیر بن حرب نے بیان کیا ان سے ابن فضیل نے اور ان سے ابوہریرہ رضی اللہ عنہ نے بیان کیا کہ نبی کریم صلی اللہ علیہ وسلم نے فرمایا";

describe("book names meet through the registry", () => {
  it("resolves slugs, Arabic titles and Urdu labels to one id", () => {
    expect(bookIdOf("bukhari")).toBe("bukhari");
    expect(bookIdOf("صحيح البخاري")).toBe("bukhari");
    expect(bookIdOf("صحیح بخاری")).toBe("bukhari");
    expect(bookIdOf("Muwatta Malik")).toBe("malik");
    expect(bookIdOf("مجموع الفتاوى")).toBeNull();
    expect(bookIdOf(undefined)).toBeNull();
  });
});

describe("language and overlap helpers", () => {
  it("tells Arabic from Urdu even though they share a script", () => {
    expect(looksArabic(MATN)).toBe(true);
    expect(looksArabic(URDU)).toBe(false);
    expect(looksArabic("")).toBe(false);
  });
  it("overlap tolerates diacritics and an isnad on one side only", () => {
    expect(arabicOverlap("كَلِمَتانِ خَفيفَتانِ على اللِّسانِ ثَقيلَتانِ في الميزانِ حَبيبَتانِ إلى الرَّحمَنِ", ISNAD)).toBeGreaterThan(0.8);
    expect(arabicOverlap(MATN, "قال الله تعالى ولا تقربوا الزنا انه كان فاحشة وساء سبيلا")).toBeLessThan(0.3);
  });
});

type Row = { domain: string; content: string; content_ar?: string; citation_ref: Record<string, unknown> };

describe("groupWitnesses", () => {
  const corpus = (): Row => ({ domain: "hadith-json", content: URDU, content_ar: ISNAD, citation_ref: { collection: "bukhari", hadith_number: "6406" } as Record<string, unknown> });
  const dorar = (): Row => ({ domain: "dorar", content: MATN + " [صحيح البخاري، رقم: 6406]", citation_ref: { book: "صحيح البخاري", hadith_number: "6406", grade: "صحيح" } as Record<string, unknown> });

  it("joins the corpus row and the live-API row for the same hadith into the first one", () => {
    const a = corpus(), b = dorar();
    const out = groupWitnesses([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(a); // identity kept for tier maps
    expect(out[0].content).toBe(URDU);
    expect(out[0].content_ar).toBe(ISNAD);
    expect(out[0].citation_ref.grade).toBe("صحيح");
    expect(out[0].citation_ref.also_in).toEqual(["صحيح البخاري"]);
  });

  it("works whichever witness comes first", () => {
    const a = dorar(), b = corpus();
    const out = groupWitnesses([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(a);
    expect(out[0].content).toBe(URDU);
    expect(out[0].content_ar).toBe(ISNAD);
  });

  it("does NOT merge equal numbers whose Arabic differs (editions number differently)", () => {
    const other = { ...dorar(), content: "قال الله تعالى ولا تقربوا الزنا انه كان فاحشة وساء سبيلا ومن يقتل مؤمنا متعمدا فجزاؤه جهنم" };
    expect(groupWitnesses([corpus(), other])).toHaveLength(2);
  });

  it("does NOT merge a row with no Arabic to compare, or one with an unknown book", () => {
    const urduOnly = { domain: "urdu-hadith", content: URDU, citation_ref: { collection: "bukhari", hadith_number: "6406" } };
    expect(groupWitnesses([corpus(), urduOnly])).toHaveLength(2);
    const unknown = { ...dorar(), citation_ref: { book: "كتاب غير معروف", hadith_number: "6406" } };
    expect(groupWitnesses([corpus(), unknown])).toHaveLength(2);
  });

  it("never merges two rows of the same domain (that is resultIdentity's job)", () => {
    expect(groupWitnesses([corpus(), corpus()])).toHaveLength(2);
  });

  it("leaves a list with nothing to join exactly as it was", () => {
    const rows = [corpus()];
    expect(groupWitnesses(rows)).toBe(rows);
  });
});
