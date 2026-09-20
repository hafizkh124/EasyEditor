// @vitest-environment node
import {
  resultIdentity,
  dedupeResults,
  type IdentifiableResult,
} from "../../supabase/functions/_shared/resultIdentity";

/**
 * `islamic-search` fans out over six tiers and concatenates their rows. Tier B
 * (pgvector) and Tier K (lexical) read the same table, and Tier D (classical,
 * semantic) overlaps Tier K on fatwa rows — so the same passage could occupy
 * two or three of an answer's source slots.
 *
 * The danger in fixing that is over-merging: a de-duplicator that invents a
 * key for rows it cannot identify deletes real results instead of duplicates.
 * That is what most of these tests guard.
 */

const row = (citation_ref: IdentifiableResult["citation_ref"]): IdentifiableResult => ({ citation_ref });

describe("resultIdentity", () => {
  it("identifies a Quran ayah by surah and verse", () => {
    expect(resultIdentity(row({ surah_number: 2, verse: 255 }))).toBe("quran:2:255");
  });

  it("treats string and numeric surah/verse as the same ayah", () => {
    // Tier-A API rows arrive with numbers; some corpus rows stringify them.
    const a = resultIdentity(row({ surah_number: 2, verse: 255 }));
    const b = resultIdentity(row({ surah_number: "2" as unknown as number, verse: "255" as unknown as number }));
    expect(a).toBe(b);
  });

  it("identifies a hadith by collection and number", () => {
    expect(resultIdentity(row({ collection: "bukhari", hadith_number: 1 }))).toBe("hadith:bukhari:1");
  });

  it("falls back to `book` when `collection` is absent", () => {
    expect(resultIdentity(row({ book: "bukhari", hadith_number: "1" }))).toBe("hadith:bukhari:1");
  });

  it("matches the same hadith across tiers that format it differently", () => {
    // Tier B builds a fresh citation_ref; Tier K passes the DB row through
    // with extra keys. Same underlying row must collapse to one identity.
    const tierB = row({ collection: "mishkat_almasabih", book: "مشکاۃ", hadith_number: 12 });
    const tierK = row({ collection: "mishkat_almasabih", hadith_number: "12", takhreej: "…", chapter: "…" });
    expect(resultIdentity(tierB)).toBe(resultIdentity(tierK));
  });

  it("identifies a fatwa or classical row by its canonical URL", () => {
    expect(resultIdentity(row({ url: "https://urdufatwa.com/q/1234" }))).toBe("url:https://urdufatwa.com/q/1234");
  });

  it("returns null when there is no trustworthy identity", () => {
    // The old anchor-merge key produced ":|:" for all of these, which would
    // have collapsed every fatwa ruling in the corpus into a single row.
    expect(resultIdentity(row({}))).toBeNull();
    expect(resultIdentity(row({ scholar: "مفتی صاحب", discipline: "fatwa" }))).toBeNull();
    expect(resultIdentity({})).toBeNull();
  });

  it("refuses a half-identity: a book with no number, or a surah with no verse", () => {
    expect(resultIdentity(row({ collection: "bukhari" }))).toBeNull();
    expect(resultIdentity(row({ hadith_number: 7 }))).toBeNull();
    expect(resultIdentity(row({ surah_number: 2 }))).toBeNull();
    expect(resultIdentity(row({ verse: 255 }))).toBeNull();
  });

  it("ignores blank strings that would otherwise pass as an identity", () => {
    expect(resultIdentity(row({ collection: "   ", hadith_number: 7 }))).toBeNull();
    expect(resultIdentity(row({ collection: "bukhari", hadith_number: "  " }))).toBeNull();
    expect(resultIdentity(row({ url: "   " }))).toBeNull();
  });

  it("keeps a live-API hadith distinct from the same hadith in the corpus", () => {
    // Dorar says "صحيح البخاري"; the corpus says "bukhari". These are separate
    // witnesses with their own wording and grading — merging them would hide
    // a source the scholar asked for, not remove a duplicate.
    const dorar = row({ book: "صحيح البخاري", hadith_number: 1 });
    const corpus = row({ collection: "bukhari", hadith_number: 1 });
    expect(resultIdentity(dorar)).not.toBe(resultIdentity(corpus));
  });

  it("identifies a classical or Turath book passage by book_id and page", () => {
    expect(resultIdentity(row({ book_id: 2166, page: 12 }))).toBe("classical:2166:12");
  });

  it("treats string and numeric book_id/page as the same passage", () => {
    const a = resultIdentity(row({ book_id: 2166, page: 12 }));
    const b = resultIdentity(row({ book_id: "2166", page: "12" }));
    expect(a).toBe("classical:2166:12");
    expect(a).toBe(b);
  });

  it("refuses a half-identity: book_id without page, or page without book_id", () => {
    expect(resultIdentity(row({ book_id: 2166 }))).toBeNull();
    expect(resultIdentity(row({ page: 12 }))).toBeNull();
  });

  it("ignores blank book_id or page strings", () => {
    expect(resultIdentity(row({ book_id: "   ", page: 12 }))).toBeNull();
    expect(resultIdentity(row({ book_id: 2166, page: "   " }))).toBeNull();
  });

  it("refuses NaN or sentinel strings for book_id or page", () => {
    expect(resultIdentity(row({ book_id: NaN, page: 12 }))).toBeNull();
    expect(resultIdentity(row({ book_id: 2166, page: NaN }))).toBeNull();
    expect(resultIdentity(row({ book_id: "NaN", page: 12 }))).toBeNull();
    expect(resultIdentity(row({ book_id: "null", page: 12 }))).toBeNull();
    expect(resultIdentity(row({ book_id: 2166, page: "undefined" }))).toBeNull();
  });

  it("identifies classical passages via shamela_id and page_number aliases", () => {
    expect(resultIdentity(row({ shamela_id: 2166, page_number: 12 }))).toBe("classical:2166:12");
    expect(resultIdentity(row({ book_id: 2166, page_number: 12 }))).toBe("classical:2166:12");
    expect(resultIdentity(row({ shamela_id: "2166", page: "12" }))).toBe("classical:2166:12");
  });
});

describe("dedupeResults", () => {
  it("collapses the same passage returned by two tiers, keeping the first", () => {
    const tierB = row({ collection: "bukhari", hadith_number: 1, grade: "صحيح" });
    const tierK = row({ collection: "bukhari", hadith_number: 1, takhreej: "…" });
    const out = dedupeResults([tierB, tierK]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(tierB);
  });

  it("preserves order and keeps every distinct passage", () => {
    const a = row({ surah_number: 2, verse: 255 });
    const b = row({ collection: "bukhari", hadith_number: 1 });
    const c = row({ url: "https://urdufatwa.com/q/9" });
    expect(dedupeResults([a, b, c])).toEqual([a, b, c]);
  });

  it("never drops rows that have no identity, even identical-looking ones", () => {
    // Two unidentifiable fatwa rows are two real rulings, not one duplicate.
    const a = row({ scholar: "مفتی الف" });
    const b = row({ scholar: "مفتی ب" });
    const c = row({});
    expect(dedupeResults([a, b, c])).toHaveLength(3);
  });

  it("de-dupes a fatwa ruling arriving from both Tier K and Tier D", () => {
    // The concrete regression: Tier K finds urdufatwa lexically, Tier D finds
    // the same ruling semantically, and both used to reach the citation panel.
    const tierK = row({ discipline: "fatwa", fatwa_number: "1234", url: "https://urdufatwa.com/q/1234" });
    const tierD = row({ discipline: "fatwa", fatwa_number: "1234", url: "https://urdufatwa.com/q/1234", scholar: "…" });
    expect(dedupeResults([tierK, tierD])).toHaveLength(1);
  });

  it("de-dupes a classical book passage arriving from both Tier D and Tier T", () => {
    // Tier D retrieves classical chunk from local pgvector; Tier T retrieves
    // the same book page from Turath.io API.
    const tierD = row({ book_id: 2166, page: 12, book_name: "المبسوط", author: "السرخسي" });
    const tierT = row({ book_id: "2166", page: "12", book_name: "المبسوط", author: "السرخسي", snip: "..." });
    const out = dedupeResults([tierD, tierT]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(tierD);
  });

  it("handles an empty list", () => {
    expect(dedupeResults([])).toEqual([]);
  });
});
