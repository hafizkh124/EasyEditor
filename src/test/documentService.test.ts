import { describe, it, expect } from "vitest";
import { extractPlainTextFromJSON, countWords } from "../core/workspace/documentService";

describe("documentService — extractPlainTextFromJSON", () => {
  it("returns empty string for null or empty node", () => {
    expect(extractPlainTextFromJSON(null)).toBe("");
    expect(extractPlainTextFromJSON(undefined)).toBe("");
    expect(extractPlainTextFromJSON({})).toBe("");
  });

  it("extracts text from a single paragraph node", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "بسم الله الرحمن الرحيم" }],
        },
      ],
    };
    expect(extractPlainTextFromJSON(doc)).toBe("بسم الله الرحمن الرحيم");
  });

  it("extracts text with newlines across multiple paragraphs and headings", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "مقدمة" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "هذا النص التجريبي الأول." }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "وهذا الفقرة الثانية." }],
        },
      ],
    };

    const text = extractPlainTextFromJSON(doc);
    expect(text).toContain("مقدمة");
    expect(text).toContain("هذا النص التجريبي الأول.");
    expect(text).toContain("وهذا الفقرة الثانية.");
    expect(text.split("\n").length).toBeGreaterThanOrEqual(3);
  });

  // Regression: a marked word splits the paragraph into several text nodes, and
  // the spaces around it sit at the node edges. Trimming per node glued the
  // words together ("قال الإماممالكرحمه الله").
  it("keeps the spaces around a marked word inside a paragraph", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "قال الإمام " },
            { type: "text", marks: [{ type: "bold" }], text: "مالك" },
            { type: "text", text: " رحمه الله" },
          ],
        },
      ],
    };

    const text = extractPlainTextFromJSON(doc);
    expect(text).toBe("قال الإمام مالك رحمه الله");
    expect(countWords(text)).toBe(5);
  });

  it("does not leak leading or trailing whitespace", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "  أول  " }] },
        { type: "paragraph", content: [{ type: "text", text: "آخر" }] },
      ],
    };
    expect(extractPlainTextFromJSON(doc)).toBe("أول  \nآخر");
  });

  describe("countWords", () => {
    it("returns 0 for empty text", () => {
      expect(countWords("")).toBe(0);
      expect(countWords("   ")).toBe(0);
    });

    it("counts words separated by any whitespace, including newlines", () => {
      expect(countWords("one two\nthree  four")).toBe(4);
    });
  });
});
