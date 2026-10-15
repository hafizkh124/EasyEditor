// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { demoteQuranAndWeak, isWeakRow, asksForQuran } from "../../supabase/functions/_shared/rulingRank";

type Row = { domain: string; content?: string; citation_ref?: Record<string, unknown>; id: string };
const r = (id: string, domain: string, extra: Partial<Row> = {}): Row => ({ id, domain, content: "نص", citation_ref: {}, ...extra });
const ids = (rows: Row[]) => rows.map((x) => x.id);
const Q = "نماز میں بچے کو اٹھانے کا حکم";

describe("demoteQuranAndWeak", () => {
  it("puts hadith first, then verses, then weak-graded rows — each in original order", () => {
    const rows = [
      r("v1", "tanzil"), r("w1", "x", { citation_ref: { collection: "silsilah-daeefah" } }),
      r("h1", "hadith-json"), r("v2", "quran-com"),
      r("w2", "x", { content: "نص [الجامع الصغير، رقم: 5667 — ضعيف]" }), r("h2", "hadith-json"),
    ];
    expect(ids(demoteQuranAndWeak(rows, Q))).toEqual(["h1", "h2", "v1", "v2", "w1", "w2"]);
  });

  it("leaves everything alone when the question asks for the Qur'an", () => {
    const rows = [r("v1", "tanzil"), r("h1", "hadith-json")];
    for (const q of ["نماز کے بارے میں آیات", "تفسیر سورہ بقرہ", "الآيات عن الصلاة"]) {
      expect(demoteQuranAndWeak(rows, q)).toBe(rows);
    }
    expect(asksForQuran(Q)).toBe(false);
  });

  it("keeps anchors first and never drops a row", () => {
    const anchor = r("a", "tanzil", { citation_ref: { _is_anchor: true } });
    const rows = [r("v", "tanzil"), anchor, r("h", "hadith-json")];
    const out = demoteQuranAndWeak(rows, Q);
    expect(ids(out)).toEqual(["a", "h", "v"]);
    expect(out).toHaveLength(3);
  });

  it("returns the same array when there is nothing to move or nothing better to promote", () => {
    const clean = [r("h1", "hadith-json"), r("h2", "hadith-json")];
    expect(demoteQuranAndWeak(clean, Q)).toBe(clean);
    const onlyVerses = [r("v1", "tanzil"), r("v2", "quran-com")];
    expect(demoteQuranAndWeak(onlyVerses, Q)).toBe(onlyVerses);
    expect(demoteQuranAndWeak(clean, "")).toBe(clean);
  });

  it("recognises weak grades only from the collection or the row's own grade tag", () => {
    expect(isWeakRow(r("x", "d", { citation_ref: { collection: "daif-al-jami" } }))).toBe(true);
    expect(isWeakRow(r("x", "d", { content: "نص — موضوع" }))).toBe(true);
    expect(isWeakRow(r("x", "d", { content: "نص — صحيح" }))).toBe(false);
    // the word appearing in the matn itself is not a grade
    expect(isWeakRow(r("x", "d", { content: "قال ضعيف الإيمان من فعل ذلك وبعده كلام طويل لا علاقة له بالتصحيح أبدا ولا بالتضعيف وهكذا" }))).toBe(false);
  });

  it("islamic-search applies it after the rerank and before the phrase priority", () => {
    const src = readFileSync("supabase/functions/islamic-search/index.ts", "utf8");
    const rerank = src.indexOf("allResults = await fuseAndRerank(");
    const demote = src.indexOf("allResults = demoteQuranAndWeak(allResults, query)");
    const phrase = src.indexOf("allResults = prioritizePhraseHits(allResults, query)");
    expect(demote).toBeGreaterThan(rerank);
    expect(phrase).toBeGreaterThan(demote);
  });
});
