// @vitest-environment node
import { describe, it, expect } from "vitest";
import { markdownToHtml, deriveTitleFromText } from "../lib/editor/htmlText";

/**
 * P0: research answers were inserted into the Canvas via `textToHtml`, which
 * escapes everything and only emits <p> — so `**سوال:**` and `## عنوان` landed
 * in the document as literal asterisks and hashes. These pin the subset the AI
 * output actually uses, and that escaping still happens first.
 */
describe("markdownToHtml", () => {
  it("converts bold and italic", () => {
    expect(markdownToHtml("**سوال:** جواب")).toBe("<p><strong>سوال:</strong> جواب</p>");
    expect(markdownToHtml("*زور* دیا")).toBe("<p><em>زور</em> دیا</p>");
  });

  it("converts headings at every level", () => {
    expect(markdownToHtml("## عنوان")).toBe("<h2>عنوان</h2>");
    expect(markdownToHtml("###### چھوٹا")).toBe("<h6>چھوٹا</h6>");
  });

  it("groups consecutive bullets into one list", () => {
    expect(markdownToHtml("- ایک\n- دو")).toBe("<ul><li>ایک</li><li>دو</li></ul>");
  });

  it("groups numbered items into an ordered list", () => {
    expect(markdownToHtml("1. ایک\n2. دو")).toBe("<ol><li>ایک</li><li>دو</li></ol>");
  });

  it("starts a new list when the marker type changes", () => {
    expect(markdownToHtml("- ایک\n1. دو")).toBe("<ul><li>ایک</li></ul><ol><li>دو</li></ol>");
  });

  it("separates paragraphs on blank lines and keeps single newlines as breaks", () => {
    expect(markdownToHtml("پہلا\nدوسرا\n\nتیسرا")).toBe("<p>پہلا<br>دوسرا</p><p>تیسرا</p>");
  });

  it("handles blockquotes and horizontal rules", () => {
    expect(markdownToHtml("> اقتباس")).toBe("<blockquote><p>اقتباس</p></blockquote>");
    expect(markdownToHtml("---")).toBe("<hr>");
  });

  it("renders links with a safe rel", () => {
    expect(markdownToHtml("[متن](https://example.com)")).toBe(
      '<p><a href="https://example.com" rel="noopener noreferrer">متن</a></p>',
    );
  });

  it("leaves code spans and fences unformatted inside", () => {
    expect(markdownToHtml("`**نہیں**`")).toBe("<p><code>**نہیں**</code></p>");
    expect(markdownToHtml("```\n**نہیں**\n```")).toBe("<pre><code>**نہیں**</code></pre>");
  });

  it("escapes HTML before applying any markdown", () => {
    const html = markdownToHtml('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("escapes HTML smuggled inside emphasis", () => {
    expect(markdownToHtml("**<script>**")).toBe("<p><strong>&lt;script&gt;</strong></p>");
  });

  it("returns an empty string for empty input", () => {
    expect(markdownToHtml("")).toBe("");
    expect(markdownToHtml("   \n  ")).toBe("");
  });

  it("does not confuse a NUL in the source with its code-span placeholder", () => {
    // The code-span parking uses NUL as a sentinel on the premise that escaped
    // input cannot contain one — but escapeHtml passes a NUL straight through,
    // so a NUL-digits-NUL run in the source could otherwise be mistaken for a
    // parked span and restored as `undefined`.
    const NUL = String.fromCharCode(0);
    const out = markdownToHtml(`before ${NUL}0${NUL} after`);
    expect(out).not.toContain("undefined");
    expect(out).toContain("before");
    expect(out).toContain("after");
  });
});

describe("deriveTitleFromText", () => {
  it("prefers the first heading, without its hashes", () => {
    expect(deriveTitleFromText("## نماز کے احکام\n\nمتن")).toBe("نماز کے احکام");
  });

  it("falls back to the first non-empty line", () => {
    expect(deriveTitleFromText("\n\nپہلی سطر\nدوسری")).toBe("پہلی سطر");
  });

  it("strips inline markdown from the derived title", () => {
    expect(deriveTitleFromText("**زور دار** عنوان")).toBe("زور دار عنوان");
  });

  it("truncates long titles with an ellipsis", () => {
    const long = "ا".repeat(80);
    const title = deriveTitleFromText(long, 60);
    expect(title).toHaveLength(61);
    expect(title.endsWith("…")).toBe(true);
  });

  it("returns an empty string when there is nothing usable", () => {
    expect(deriveTitleFromText("")).toBe("");
    expect(deriveTitleFromText("\n\n   \n")).toBe("");
    expect(deriveTitleFromText("###")).toBe("");
  });
});
