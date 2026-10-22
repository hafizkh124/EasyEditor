import { describe, it, expect } from "vitest";
import { alignParagraphs, joinParagraphs, replaceParagraph, splitParagraphs } from "@/lib/translate/paragraphs";
import {
  cleanGlossary, composeInstruction, glossaryFor, glossaryMisses, parseGlossary, parseGlossaryText, PARAGRAPH_RULE,
} from "@/lib/translate/glossary";
import { buildBookHtml } from "@/lib/translate/bookExport";

describe("splitParagraphs", () => {
  it("splits on blank lines", () => {
    expect(splitParagraphs("الأول\n\nالثاني\n \nالثالث")).toEqual(["الأول", "الثاني", "الثالث"]);
  });
  it("joins OCR lines until a sentence ends", () => {
    expect(splitParagraphs("قال الشيخ رحمه\nالله تعالى.\nوهذا باب\nآخر؛")).toEqual(["قال الشيخ رحمه الله تعالى.", "وهذا باب آخر؛"]);
  });
  it("keeps a trailing unfinished line as its own paragraph", () => {
    expect(splitParagraphs("one.\ntwo")).toEqual(["one.", "two"]);
    expect(splitParagraphs("  ")).toEqual([]);
  });
});

describe("alignParagraphs", () => {
  const src = ["a", "b"];
  it("pairs blank-line paragraphs", () => {
    expect(alignParagraphs(src, "A\n\nB")).toEqual(["A", "B"]);
  });
  it("accepts single line breaks when they match", () => {
    expect(alignParagraphs(src, "A\nB")).toEqual(["A", "B"]);
  });
  it("gives up when the counts differ", () => {
    expect(alignParagraphs(src, "A B")).toBeNull();
    expect(alignParagraphs(src, "")).toBeNull();
  });
  it("replaces one paragraph", () => {
    expect(replaceParagraph(src, "A\n\nB", 1, " B2 ")).toBe(joinParagraphs(["A", "B2"]));
    expect(replaceParagraph(src, "AB", 0, "x")).toBeNull();
  });
});

describe("glossary", () => {
  it("cleans, dedupes and parses", () => {
    expect(cleanGlossary([{ source: " صلاۃ ", target: "Salah" }, { source: "", target: "x" }, { source: "صلاۃ", target: "Prayer" }]))
      .toEqual([{ source: "صلاۃ", target: "Prayer" }]);
    expect(parseGlossary([{ source: "a", target: "b" }, { source: 1 }, null])).toEqual([{ source: "a", target: "b" }]);
    expect(parseGlossary("nope")).toEqual([]);
    expect(parseGlossaryText("صلاة = Salah\nزكاة ← Zakah\nصوم\tSawm\nحج -> Hajj\nعمرة => Umrah\nbad line"))
      .toEqual([
        { source: "صلاة", target: "Salah" }, { source: "زكاة", target: "Zakah" }, { source: "صوم", target: "Sawm" },
        { source: "حج", target: "Hajj" }, { source: "عمرة", target: "Umrah" },
      ]);
  });

  const glossary = [{ source: "الصلاة", target: "Salah" }, { source: "الزكاة", target: "Zakah" }];

  it("finds terms in voweled text", () => {
    expect(glossaryFor("أَقِيمُوا الصَّلَاةَ", glossary)).toEqual([glossary[0]]);
  });
  it("reports terms the translation did not keep", () => {
    expect(glossaryMisses("الصلاة والزكاة", "Establish salah and give alms", glossary)).toEqual([glossary[1]]);
    expect(glossaryMisses("الصلاة", "", glossary)).toEqual([]);
  });
  it("composes the instruction", () => {
    const out = composeInstruction({ genrePrompt: "Fiqh text.", style: "literal", glossary, text: "باب الصلاة", extra: "More fluent." });
    expect(out).toContain("Fiqh text.");
    expect(out).toContain("literal");
    expect(out).toContain("- الصلاة → Salah");
    expect(out).not.toContain("Zakah");
    expect(out).toContain(PARAGRAPH_RULE);
    expect(out.endsWith("More fluent.")).toBe(true);
    const image = composeInstruction({ style: "idiomatic", glossary, paragraphs: false });
    expect(image).toContain("Zakah");
    expect(image).not.toContain(PARAGRAPH_RULE);
  });
});

describe("buildBookHtml", () => {
  const pages = [
    { pageNum: 1, sourceText: "الأول\n\nالثاني", translationText: "First\n\nSecond" },
    { pageNum: 2, sourceText: "ثالث", translationText: "" },
    { pageNum: 3, sourceText: "رابع\n\nخامس", translationText: "Fourth <b>" },
  ];
  it("exports the translation alone", () => {
    const html = buildBookHtml(pages, "translation", { pageLabel: "صفحہ" });
    expect(html).toContain("<h2>صفحہ 1</h2>");
    expect(html).toContain('<p dir="ltr">First</p><p dir="ltr">Second</p>');
    expect(html).not.toContain("صفحہ 2");
    expect(html).toContain("Fourth &lt;b&gt;");
    expect(html).not.toContain("الأول");
  });
  it("exports bilingual rows, falling back to one row per page", () => {
    const html = buildBookHtml(pages, "bilingual");
    expect(html).toContain('<tr><td dir="rtl">الأول</td><td dir="ltr">First</td></tr><tr><td dir="rtl">الثاني</td><td dir="ltr">Second</td></tr>');
    expect(html).toContain('<tr><td dir="rtl">رابع<br>خامس</td><td dir="ltr">Fourth &lt;b&gt;</td></tr>');
  });
});
