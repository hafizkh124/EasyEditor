import { describe, it, expect } from "vitest";
import searchFixture from "./fixtures/turath/search.json";
import pageFixture from "./fixtures/turath/page.json";
import bookFixture from "./fixtures/turath/book.json";
import {
  stripTurathHtml,
  parseTurathMeta,
  normalizeTurathSearchHit,
  normalizeTurathBook,
} from "../../supabase/functions/_shared/turath";
import { resultIdentity } from "../../supabase/functions/_shared/resultIdentity";

describe("turath normalizer", () => {
  describe("stripTurathHtml", () => {
    it("strips <em> highlight tags and normalizes whitespace", () => {
      const raw = "والأصل في ذلك قوله تعالى: <em>يا أيها الذين آمنوا</em> فاغسلوا";
      expect(stripTurathHtml(raw)).toBe(
        "والأصل في ذلك قوله تعالى: يا أيها الذين آمنوا فاغسلوا"
      );
    });

    it("returns empty string on null or undefined", () => {
      expect(stripTurathHtml(null)).toBe("");
      expect(stripTurathHtml(undefined)).toBe("");
      expect(stripTurathHtml("")).toBe("");
    });
  });

  describe("parseTurathMeta", () => {
    it("parses valid JSON meta string", () => {
      const meta = parseTurathMeta(searchFixture[0].meta);
      expect(meta.book_name).toBe("المبسوط");
      expect(meta.author_name).toBe("السرخسي");
      expect(meta.page).toBe(12);
      expect(meta.vol).toBe(1);
      expect(meta.headings).toEqual(["كتاب الطهارة", "باب الوضوء"]);
    });

    it("handles pre-parsed meta objects without throwing", () => {
      const meta = parseTurathMeta({ book_name: "المبسوط", page: 12 });
      expect(meta.book_name).toBe("المبسوط");
    });

    it("returns empty object on malformed or empty meta", () => {
      expect(parseTurathMeta("{invalid-json")).toEqual({});
      expect(parseTurathMeta("")).toEqual({});
      expect(parseTurathMeta(null)).toEqual({});
    });
  });

  describe("normalizeTurathSearchHit", () => {
    it("normalizes search fixture hit into clean bibliographic structure", () => {
      const hit = normalizeTurathSearchHit(searchFixture[0]);
      expect(hit.book_id).toBe("2166");
      expect(hit.book_name).toBe("المبسوط");
      expect(hit.author_name).toBe("السرخسي");
      expect(hit.page).toBe(12);
      expect(hit.vol).toBe(1);
      expect(hit.headings).toEqual(["كتاب الطهارة", "باب الوضوء"]);
      expect(hit.snippet).not.toContain("<em>");
      expect(hit.snippet).not.toContain("</em>");
      expect(hit.snippet).toContain("يا أيها الذين آمنوا");

      // Citation ref should cleanly plug into resultIdentity
      const identity = resultIdentity({ citation_ref: hit.citation_ref });
      expect(identity).toBe("classical:2166:12");
    });

    it("normalizes page fixture hit", () => {
      const page = normalizeTurathSearchHit(pageFixture);
      expect(page.book_id).toBe("2166");
      expect(page.book_name).toBe("المبسوط");
      expect(page.page).toBe(12);
      expect(page.text).toContain("الطهور شطر الإيمان");

      const identity = resultIdentity({ citation_ref: page.citation_ref });
      expect(identity).toBe("classical:2166:12");
    });
  });

  describe("normalizeTurathBook", () => {
    it("normalizes book fixture metadata", () => {
      const book = normalizeTurathBook(bookFixture);
      expect(book.book_id).toBe("2166");
      expect(book.title).toBe("المبسوط");
      expect(book.author).toBe("محمد بن أحمد بن أبي سهل السرخسي");
      expect(book.category).toBe("الفقه الحنفي");
      expect(book.vol_count).toBe(30);
      expect(book.page_count).toBe(12450);
    });
  });
});
