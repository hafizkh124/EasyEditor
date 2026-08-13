import { describe, it, expect } from "vitest";
import { translationChunksToHtml, htmlToTiptapJSON } from "../core/workspace/bookSectionMigration";

/**
 * `backfillTranslationProjects` only ever linked the project row, so the chunk
 * content — the actual translation work — had no path into projects/documents.
 * These pin the conversion that closes that gap, before /translate-workspace is
 * retired and the two-column editor stops being a way to reach it.
 */

type Chunk = Parameters<typeof translationChunksToHtml>[0][number];

const chunk = (partial: Partial<Chunk> & { chunk_index: number }): Chunk => ({
  source_text: null,
  translated_text: null,
  notes: null,
  ...partial,
});

describe("translationChunksToHtml", () => {
  it("pairs each source with its translation, source first", () => {
    const html = translationChunksToHtml([
      chunk({ chunk_index: 1, source_text: "الحمد لله", translated_text: "تمام تعریفیں اللہ کے لیے" }),
    ]);
    expect(html).toBe("<blockquote><p>الحمد لله</p></blockquote>\n<p>تمام تعریفیں اللہ کے لیے</p>");
  });

  it("emits chunks in index order, not the order the rows arrived", () => {
    const html = translationChunksToHtml([
      chunk({ chunk_index: 3, translated_text: "تیسرا" }),
      chunk({ chunk_index: 1, translated_text: "پہلا" }),
      chunk({ chunk_index: 2, translated_text: "دوسرا" }),
    ]);
    expect(html.indexOf("پہلا")).toBeLessThan(html.indexOf("دوسرا"));
    expect(html.indexOf("دوسرا")).toBeLessThan(html.indexOf("تیسرا"));
  });

  it("keeps a source that was never translated", () => {
    // Half-finished work is the common case; dropping it would lose the book.
    const html = translationChunksToHtml([chunk({ chunk_index: 1, source_text: "بسم الله" })]);
    expect(html).toContain("بسم الله");
  });

  it("keeps a translation whose source was cleared", () => {
    const html = translationChunksToHtml([chunk({ chunk_index: 1, translated_text: "صرف ترجمہ" })]);
    expect(html).toBe("<p>صرف ترجمہ</p>");
  });

  it("drops chunks with nothing on either side", () => {
    const html = translationChunksToHtml([
      chunk({ chunk_index: 1, source_text: "   ", translated_text: "" }),
      chunk({ chunk_index: 2, translated_text: "اصل مواد" }),
    ]);
    expect(html).toBe("<p>اصل مواد</p>");
  });

  it("carries notes through, marked as subordinate", () => {
    const html = translationChunksToHtml([
      chunk({ chunk_index: 1, translated_text: "متن", notes: "مترجم کا نوٹ" }),
    ]);
    expect(html).toContain("<em>مترجم کا نوٹ</em>");
  });

  it("escapes markup in the stored text instead of injecting it", () => {
    // Chunks are user text, not HTML. An unescaped "<" would silently
    // restructure the migrated document.
    const html = translationChunksToHtml([
      chunk({ chunk_index: 1, source_text: "a < b & c", translated_text: "<script>x</script>" }),
    ]);
    expect(html).toContain("a &lt; b &amp; c");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("produces an empty string when every chunk is blank", () => {
    // The caller uses this to skip creating a document at all.
    expect(translationChunksToHtml([chunk({ chunk_index: 1 })])).toBe("");
  });

  it("survives the trip through the editor schema", () => {
    const html = translationChunksToHtml([
      chunk({ chunk_index: 1, source_text: "المصدر", translated_text: "ترجمہ" }),
    ]);
    const json = htmlToTiptapJSON(html) as { type: string; content?: unknown[] };
    expect(json.type).toBe("doc");
    // The blockquote must survive — it is what distinguishes source from
    // translation once the two columns are gone.
    expect(JSON.stringify(json)).toContain("blockquote");
    expect(JSON.stringify(json)).toContain("المصدر");
    expect(JSON.stringify(json)).toContain("ترجمہ");
  });
});
