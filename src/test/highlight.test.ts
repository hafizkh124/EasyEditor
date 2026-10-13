import { describe, it, expect } from "vitest";
import { highlightSegments, queryWords, foldWithMap } from "@/lib/citations/highlight";

const join = (segs: ReturnType<typeof highlightSegments>) => segs.map((s) => s.text).join("");
const marked = (segs: ReturnType<typeof highlightSegments>) => segs.filter((s) => s.match).map((s) => s.text);

describe("query words", () => {
  it("keeps 3+ letter Arabic words, folded and deduplicated", () => {
    expect(queryWords("إنما الأعمال بالنيات")).toEqual(["انما", "الاعمال", "بالنيات"]);
  });
  it("returns nothing for an Urdu question (everyday words would mark everything)", () => {
    expect(queryWords("پڑوسی کے حقوق")).toEqual([]);
    expect(queryWords("والدین کے ساتھ حسنِ سلوک کی احادیث")).toEqual([]);
  });
  it("ignores empty and very short queries", () => {
    expect(queryWords("")).toEqual([]);
    expect(queryWords(undefined)).toEqual([]);
    expect(queryWords("في")).toEqual([]);
  });
});

describe("highlightSegments", () => {
  it("finds a word that carries harakat and keeps them inside the match", () => {
    const text = "إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ وَإِنَّمَا لِكُلِّ امْرِئٍ مَا نَوَى";
    const segs = highlightSegments(text, "إنما الأعمال بالنيات");
    expect(join(segs)).toBe(text); // never loses or reorders a character
    expect(marked(segs)).toEqual(["إِنَّمَا", "الأَعْمَالُ", "بِالنِّيَّاتِ", "إِنَّمَا"]);
  });

  it("treats alef variants and ta marbuta / ha the same", () => {
    const segs = highlightSegments("قال رسول الله: الدين النصيحة", "الدين النصيحه");
    expect(marked(segs)).toEqual(["الدين", "النصيحة"]);
  });

  it("returns the text untouched when nothing matches or the query is Urdu", () => {
    expect(highlightSegments("قال الله تعالى", "إنما الأعمال")).toEqual([{ text: "قال الله تعالى", match: false }]);
    expect(highlightSegments("ہم سے بیان کیا", "پڑوسی کے حقوق")).toEqual([{ text: "ہم سے بیان کیا", match: false }]);
  });

  it("marks each word once even when the query repeats it, and leaves the space unmarked", () => {
    const segs = highlightSegments("كلمتان خفيفتان", "كلمتان خفيفتان كلمتان");
    expect(join(segs)).toBe("كلمتان خفيفتان");
    expect(marked(segs)).toEqual(["كلمتان", "خفيفتان"]);
  });

  it("merges overlapping matches from different query words", () => {
    const segs = highlightSegments("الأعمال", "الاعمال اعمال");
    expect(marked(segs)).toEqual(["الأعمال"]);
  });

  it("the index map points back at the original characters", () => {
    const { folded, map } = foldWithMap("أَبْ");
    expect(folded).toBe("اب");
    expect(map).toEqual([0, 2]);
  });
});
