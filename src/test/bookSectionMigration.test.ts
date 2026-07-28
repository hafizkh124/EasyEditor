import { describe, it, expect } from "vitest";
import { htmlToTiptapJSON } from "../core/workspace/bookSectionMigration";

/** Collect every text node in a Tiptap JSON tree, with its marks. */
function collectText(node: any, out: Array<{ text: string; marks: string[] }> = []) {
  if (typeof node?.text === "string") {
    out.push({ text: node.text, marks: (node.marks ?? []).map((m: any) => m.type) });
  }
  for (const child of node?.content ?? []) collectText(child, out);
  return out;
}

/** Node types present anywhere in the tree. */
function collectTypes(node: any, out: Set<string> = new Set()) {
  if (node?.type) out.add(node.type);
  for (const child of node?.content ?? []) collectTypes(child, out);
  return out;
}

describe("bookSectionMigration — htmlToTiptapJSON", () => {
  it("converts empty HTML to an empty paragraph doc", () => {
    expect(htmlToTiptapJSON("")).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
    expect(htmlToTiptapJSON("   ")).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });

  it("converts a simple paragraph", () => {
    const json = htmlToTiptapJSON("<p>هذا فصل تجريبي في الكتاب</p>");
    expect(json.type).toBe("doc");
    expect(collectText(json).map((t) => t.text)).toEqual(["هذا فصل تجريبي في الكتاب"]);
  });

  it("keeps heading levels", () => {
    const json = htmlToTiptapJSON("<h2>الباب الأول</h2><p>متن</p>");
    const heading = (json.content as any[])[0];
    expect(heading.type).toBe("heading");
    expect(heading.attrs.level).toBe(2);
  });

  // Regression: the previous hand-rolled walker read `textContent` per block, so
  // a citation blockquote collapsed into one paragraph reading
  // "إنما الأعمال بالنيات[صحيح البخاري، حديث 1]" — quote and reference glued.
  it("preserves a citation blockquote as its own node with separate paragraphs", () => {
    const html =
      '<blockquote dir="rtl"><p>إنما الأعمال بالنيات</p><p><em>[صحيح البخاري، حديث 1]</em></p></blockquote>';
    const json = htmlToTiptapJSON(html);

    expect(collectTypes(json).has("blockquote")).toBe(true);
    const texts = collectText(json).map((t) => t.text);
    expect(texts).toContain("إنما الأعمال بالنيات");
    expect(texts).toContain("[صحيح البخاري، حديث 1]");
    // The old walker produced this single glued node instead of the two above.
    expect(texts).not.toContain("إنما الأعمال بالنيات[صحيح البخاري، حديث 1]");
  });

  // Regression: inline marks were dropped entirely.
  it("preserves inline marks and the spaces around them", () => {
    const json = htmlToTiptapJSON("<p>قال الإمام <strong>مالك</strong> رحمه الله.</p>");
    const parts = collectText(json);

    expect(parts.find((p) => p.text === "مالك")?.marks).toContain("bold");
    expect(parts.map((p) => p.text).join("")).toBe("قال الإمام مالك رحمه الله.");
  });

  // Regression: <ul><li>a</li><li>b</li></ul> became a single paragraph "ab".
  it("preserves list structure instead of merging the items", () => {
    const json = htmlToTiptapJSON("<ul><li>نکتہ اول</li><li>نکتہ دوم</li></ul>");
    const types = collectTypes(json);

    expect(types.has("bulletList")).toBe(true);
    expect(types.has("listItem")).toBe(true);
    const texts = collectText(json).map((t) => t.text);
    expect(texts).toContain("نکتہ اول");
    expect(texts).toContain("نکتہ دوم");
    // The old walker merged both items into one node.
    expect(texts).not.toContain("نکتہ اولنکتہ دوم");
  });

  it("preserves tables", () => {
    const json = htmlToTiptapJSON("<table><tbody><tr><td><p>خانہ</p></td></tr></tbody></table>");
    const types = collectTypes(json);
    expect(types.has("table")).toBe(true);
    expect(types.has("tableCell")).toBe(true);
  });

  it("yields a single empty paragraph for markup with no real content", () => {
    const json = htmlToTiptapJSON("<!-- just a comment -->");
    expect(json.type).toBe("doc");
    expect((json.content as any[]).length).toBe(1);
    expect((json.content as any[])[0].type).toBe("paragraph");
    expect(collectText(json)).toEqual([]);
  });
});
