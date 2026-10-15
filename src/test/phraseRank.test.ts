// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { phraseOf, prioritizePhraseHits, SIX_BOOKS } from "../../supabase/functions/_shared/phraseRank";

const PHRASE = "كلمتان خفيفتان على اللسان";
const withPhrase = "كَلِمَتانِ خَفيفَتانِ على اللِّسانِ ثَقيلَتانِ في الميزانِ حَبيبَتانِ إلى الرَّحمَنِ";
const without = "قال رسول الله صلى الله عليه وسلم كلمتان من قالهما دخل الجنة وهما خفيفتان";

type Row = { domain: string; content: string; content_ar?: string; citation_ref: Record<string, unknown> };
const row = (collection: string, ar: string, extra: Partial<Row["citation_ref"]> = {}): Row => ({
  domain: "x", content: "ترجمہ", content_ar: ar, citation_ref: { collection, ...extra },
});
const names = (rows: Row[]) => rows.map((r) => r.citation_ref.collection);

describe("phraseOf", () => {
  it("accepts an Arabic phrase of two or more words", () => {
    // folded the same way the corpus search folds: ى becomes ي, harakat and alef variants drop
    expect(phraseOf(PHRASE)).toBe("كلمتان خفيفتان علي اللسان");
  });
  it("rejects Urdu questions, single words and empties", () => {
    expect(phraseOf("پڑوسی کے حقوق")).toBeNull();
    expect(phraseOf("الصلاة")).toBeNull();
    expect(phraseOf("")).toBeNull();
    expect(phraseOf(undefined)).toBeNull();
  });
});

describe("prioritizePhraseHits", () => {
  it("puts exact-phrase Six Books rows first, then other phrase rows, then the rest — each in original order", () => {
    const rows = [
      row("silsilah-sahihah", without),
      row("kanz-ul-ummal", withPhrase),
      row("tirmidhi", without),
      row("muslim", withPhrase),
      row("bukhari", withPhrase),
      row("jami-kamil", without),
    ];
    expect(names(prioritizePhraseHits(rows, PHRASE))).toEqual([
      "muslim", "bukhari",          // phrase + Six Books, original order
      "kanz-ul-ummal",              // phrase, other book
      "silsilah-sahihah", "tirmidhi", "jami-kamil", // no phrase, original order
    ]);
  });

  it("matches through harakat and spelling variants, and finds the phrase in `content` too", () => {
    const viaContent: Row = { domain: "dorar", content: withPhrase, citation_ref: { book: "صحيح مسلم" } };
    const out = prioritizePhraseHits([row("kanz-ul-ummal", without), viaContent], PHRASE);
    expect(out[0]).toBe(viaContent); // "صحيح مسلم" resolves to muslim
  });

  it("never drops or duplicates a row", () => {
    const rows = [row("a", without), row("muslim", withPhrase), row("b", without)];
    const out = prioritizePhraseHits(rows, PHRASE);
    expect(out).toHaveLength(3);
    expect(new Set(out).size).toBe(3);
  });

  it("keeps pinned anchors first", () => {
    const anchor = row("tanzil", without, { _is_anchor: true });
    const out = prioritizePhraseHits([row("kanz-ul-ummal", without), anchor, row("muslim", withPhrase)], PHRASE);
    expect(out[0]).toBe(anchor);
    expect(out[1].citation_ref.collection).toBe("muslim");
  });

  it("returns the same array when there is nothing to promote or the query is not a phrase", () => {
    const rows = [row("a", without), row("b", without)];
    expect(prioritizePhraseHits(rows, PHRASE)).toBe(rows);
    expect(prioritizePhraseHits([row("muslim", withPhrase), row("a", without)], "پڑوسی کے حقوق")).toHaveLength(2);
    const urdu = [row("a", without), row("muslim", withPhrase)];
    expect(prioritizePhraseHits(urdu, "پڑوسی کے حقوق")).toBe(urdu);
  });

  it("the Six Books are exactly the six canonical ids", () => {
    expect([...SIX_BOOKS].sort()).toEqual(["abudawud", "bukhari", "ibnmajah", "muslim", "nasai", "tirmidhi"]);
  });

  it("islamic-search applies it to the ranked list before cutting off the model's ten", () => {
    const src = readFileSync("supabase/functions/islamic-search/index.ts", "utf8");
    const rerank = src.indexOf("allResults = await fuseAndRerank(");
    const phrase = src.indexOf("allResults = prioritizePhraseHits(allResults, query)");
    const cut = src.indexOf("const moreResults = allResults.slice(MODEL_SOURCES)");
    expect(phrase).toBeGreaterThan(rerank);
    expect(cut).toBeGreaterThan(phrase);
  });
});
