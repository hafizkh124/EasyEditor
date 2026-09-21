import { describe, it, expect } from "vitest";
import searchFixture from "./fixtures/turath/search.json";
import pageFixture from "./fixtures/turath/page.json";
import bookFixture from "./fixtures/turath/book.json";
import authorFixture from "./fixtures/turath/author.json";
import {
  stripTurathHtml,
  parseTurathMeta,
  extractTurathHits,
  normalizeTurathSearchHit,
  normalizeTurathPage,
  normalizeTurathBook,
  normalizeTurathAuthor,
  turathReaderUrl,
  turathPageLabel,
} from "../../supabase/functions/_shared/turath";
import { resultIdentity } from "../../supabase/functions/_shared/resultIdentity";

// The fixtures are trimmed copies of REAL api.turath.io (ver=3) responses, not
// hand-written approximations — see src/test/helpers/turathApiFake.ts.
describe("turath normalizer", () => {
  describe("stripTurathHtml", () => {
    it("strips <em> highlight tags", () => {
      expect(stripTurathHtml("قوله تعالى: <em>يا أيها الذين آمنوا</em> فاغسلوا"))
        .toBe("قوله تعالى: يا أيها الذين آمنوا فاغسلوا");
    });

    it("removes tags WITHOUT inserting a space, so a highlight inside a word cannot split it", () => {
      // Regression: replacing a tag with " " turned `<em>ال</em>ربا` into
      // "ال ربا" — two tokens — corrupting the text the model reads and quotes.
      expect(stripTurathHtml("وال<em>ربا</em>")).toBe("والربا");
      expect(stripTurathHtml("<em>ال</em>ربا")).toBe("الربا");
    });

    it("keeps the text inside a heading <span> (attributes and all)", () => {
      expect(stripTurathHtml('<span data-type="title" id=toc-110>المبحث الرابع</span>(١)'))
        .toBe("المبحث الرابع(١)");
    });

    it("keeps line breaks and turns <hr>/<br> into one, so numbered lists stay readable", () => {
      expect(stripTurathHtml("وفيه مطلبان:\n١ - الأول.\n٢ - الثاني.")).toBe("وفيه مطلبان:\n١ - الأول.\n٢ - الثاني.");
      expect(stripTurathHtml("قبل<hr>بعد")).toBe("قبل\nبعد");
      expect(stripTurathHtml("سطر<br/>سطر")).toBe("سطر\nسطر");
    });

    it("collapses runs of spaces and blank lines but not paragraph breaks", () => {
      expect(stripTurathHtml("أ   ب\n\n\n\nج")).toBe("أ ب\n\nج");
    });

    it("decodes the common HTML entities", () => {
      expect(stripTurathHtml("أ&nbsp;ب &amp; ج")).toBe("أ ب & ج");
    });

    it("returns empty string on null or undefined", () => {
      expect(stripTurathHtml(null)).toBe("");
      expect(stripTurathHtml(undefined)).toBe("");
      expect(stripTurathHtml("")).toBe("");
    });

    it("leaves no tag in any real search hit", () => {
      for (const d of searchFixture.data) {
        expect(stripTurathHtml(d.text)).not.toMatch(/<[^>]+>/);
        expect(stripTurathHtml(d.snip)).not.toMatch(/<[^>]+>/);
      }
    });
  });

  describe("extractTurathHits", () => {
    it("reads the real {count, data} envelope", () => {
      expect(extractTurathHits(searchFixture)).toHaveLength(4);
    });

    it("still accepts a bare array or {results} so a future API tweak degrades gracefully", () => {
      expect(extractTurathHits(searchFixture.data)).toHaveLength(4);
      expect(extractTurathHits({ results: searchFixture.data })).toHaveLength(4);
    });

    it("returns [] for an empty result, an empty object, or garbage", () => {
      expect(extractTurathHits({ count: 0, data: [] })).toEqual([]);
      expect(extractTurathHits({})).toEqual([]);
      expect(extractTurathHits(null)).toEqual([]);
      expect(extractTurathHits("nope")).toEqual([]);
    });
  });

  describe("parseTurathMeta", () => {
    it("parses the JSON-STRING meta of a real search hit", () => {
      expect(typeof searchFixture.data[0].meta).toBe("string");
      const meta = parseTurathMeta(searchFixture.data[0].meta);
      expect(meta.book_name).toContain("زاد المستقنع");
      expect(meta.author_name).toBe("عبد الكريم اللاحم");
      expect(meta.page).toBe(129);
      expect(meta.page_id).toBe(724);
      expect(meta.vol).toBe("2"); // the real API sends vol as a STRING
      expect(meta.headings).toHaveLength(3);
    });

    it("handles pre-parsed meta objects without throwing", () => {
      expect(parseTurathMeta({ book_name: "المبسوط", page: 12 }).book_name).toBe("المبسوط");
    });

    it("returns empty object on malformed or empty meta", () => {
      expect(parseTurathMeta("{invalid-json")).toEqual({});
      expect(parseTurathMeta("")).toEqual({});
      expect(parseTurathMeta(null)).toEqual({});
    });
  });

  describe("normalizeTurathSearchHit", () => {
    it("normalizes a real search hit, reading vol from its string form", () => {
      const hit = normalizeTurathSearchHit(searchFixture.data[0]);
      expect(hit.book_id).toBe("127708");
      expect(hit.author_name).toBe("عبد الكريم اللاحم");
      expect(hit.page).toBe(129);
      expect(hit.vol).toBe(2);
      expect(hit.page_id).toBe(724);
      expect(hit.headings).toHaveLength(3);
      expect(hit.snippet).not.toContain("<em>");
    });

    it("carries page_id, volume and page into citation_ref", () => {
      const { citation_ref } = normalizeTurathSearchHit(searchFixture.data[0]);
      expect(citation_ref).toMatchObject({ book_id: "127708", page: 129, page_id: 724, vol: 2, volume: 2 });
    });

    it("yields a volume-aware identity", () => {
      const { citation_ref } = normalizeTurathSearchHit(searchFixture.data[0]);
      expect(resultIdentity({ citation_ref })).toBe("classical:127708:v2:p129");
    });

    it("gives two hits with the same printed page in different volumes DIFFERENT identities", () => {
      const a = normalizeTurathSearchHit({ book_id: 1, meta: JSON.stringify({ page: 12, vol: "1", page_id: 12 }), text: "x" });
      const b = normalizeTurathSearchHit({ book_id: 1, meta: JSON.stringify({ page: 12, vol: "9", page_id: 900 }), text: "y" });
      expect(resultIdentity({ citation_ref: a.citation_ref })).not.toBe(resultIdentity({ citation_ref: b.citation_ref }));
    });

    it("leaves vol undefined (not 1) when Turath gives a non-numeric volume", () => {
      const hit = normalizeTurathSearchHit({ book_id: 1, meta: JSON.stringify({ page: 5, vol: "ملحق" }), text: "x" });
      expect(hit.vol).toBeUndefined();
      // …and such a row gets no identity, so it is kept rather than mis-merged.
      expect(resultIdentity({ citation_ref: hit.citation_ref })).toBeNull();
    });

    it("reads Arabic-Indic digits in vol/page", () => {
      const hit = normalizeTurathSearchHit({ book_id: 1, meta: JSON.stringify({ page: "١٢٩", vol: "٢" }), text: "x" });
      expect(hit.page).toBe(129);
      expect(hit.vol).toBe(2);
    });
  });

  describe("normalizeTurathPage", () => {
    it("normalizes a real /page response (its meta has no book_id, so the caller supplies it)", () => {
      const page = normalizeTurathPage(pageFixture, "127708");
      expect(page.book_id).toBe("127708");
      expect(page.page_id).toBe(10);
      expect(page.page).toBe(13);
      expect(page.vol).toBe(1);
      expect(page.label).toBe("ج1، ص13");
      expect(page.text).toContain("تحصل المبادلة بالقول");
    });
  });

  describe("normalizeTurathBook / normalizeTurathAuthor", () => {
    it("normalizes a real /book response ({meta:{id,name,author_id,cat_id}})", () => {
      const book = normalizeTurathBook(bookFixture);
      expect(book.book_id).toBe("127708");
      expect(book.title).toContain("زاد المستقنع");
      expect(book.author_id).toBe("611");
      expect(book.cat_id).toBe("17");
    });

    it("does not throw on an empty /book response", () => {
      expect(normalizeTurathBook({})).toMatchObject({ book_id: "0" });
    });

    it("reads the hijri death year from Arabic-Indic digits", () => {
      const a = normalizeTurathAuthor(authorFixture);
      expect(a.name).toBe("عبد الكريم اللاحم");
      expect(a.death_year).toBe(1438); // "١٤٣٨"
    });

    it("treats the empty {} an unknown author returns as no data", () => {
      expect(normalizeTurathAuthor({})).toEqual({ id: "", name: "", death_year: null });
    });
  });

  describe("turathReaderUrl / turathPageLabel", () => {
    it("links to app.turath.io, not turath.io (which 302s to the app root and drops the book)", () => {
      expect(turathReaderUrl(127708, 724)).toBe("https://app.turath.io/book/127708?page=724");
      expect(turathReaderUrl(127708, 724)).not.toContain("//turath.io");
    });

    it("deep-links with the SEQUENTIAL page_id, never the printed page", () => {
      const hit = normalizeTurathSearchHit(searchFixture.data[0]); // printed 129, page_id 724
      const url = turathReaderUrl(hit.book_id, hit.page_id);
      expect(url).toContain("page=724");
      expect(url).not.toContain("page=129");
    });

    it("links the book alone when page_id is unknown, rather than a guessed page", () => {
      expect(turathReaderUrl(127708)).toBe("https://app.turath.io/book/127708");
      expect(turathReaderUrl(127708, 0)).toBe("https://app.turath.io/book/127708");
      expect(turathReaderUrl(127708, Number.NaN)).toBe("https://app.turath.io/book/127708");
    });

    it("labels with the printed coordinates", () => {
      expect(turathPageLabel(129, 2)).toBe("ج2، ص129");
      expect(turathPageLabel(129)).toBe("ص129");
    });
  });
});
