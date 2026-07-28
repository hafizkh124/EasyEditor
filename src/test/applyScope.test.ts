import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { hasRichFormatting, shouldConfirmWholeDocument } from "../lib/editor/applyScope";
import { buildEditorExtensions } from "../components/editor/editorExtensions";

describe("applyScope — hasRichFormatting", () => {
  it("is false for a plain paragraph document", () => {
    expect(
      hasRichFormatting({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "سادہ متن" }] }],
      }),
    ).toBe(false);
  });

  it("is false for empty or missing input", () => {
    expect(hasRichFormatting(null)).toBe(false);
    expect(hasRichFormatting(undefined)).toBe(false);
    expect(hasRichFormatting({})).toBe(false);
  });

  it("detects headings", () => {
    expect(
      hasRichFormatting({
        type: "doc",
        content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "باب" }] }],
      }),
    ).toBe(true);
  });

  it("detects blockquotes, lists and tables nested anywhere", () => {
    for (const type of ["blockquote", "bulletList", "table"]) {
      expect(
        hasRichFormatting({
          type: "doc",
          content: [{ type: "paragraph" }, { type, content: [{ type: "paragraph" }] }],
        }),
      ).toBe(true);
    }
  });

  it("detects inline marks", () => {
    expect(
      hasRichFormatting({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "قال " },
              { type: "text", marks: [{ type: "bold" }], text: "مالك" },
            ],
          },
        ],
      }),
    ).toBe(true);
  });
});

describe("applyScope — shouldConfirmWholeDocument", () => {
  const rich = {
    type: "doc",
    content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "باب" }] }],
  };
  const plain = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "متن" }] }],
  };

  it("never asks when there is a selection — the rest of the document is safe", () => {
    expect(shouldConfirmWholeDocument(true, rich)).toBe(false);
  });

  it("asks when a formatted document would be rewritten wholesale", () => {
    expect(shouldConfirmWholeDocument(false, rich)).toBe(true);
  });

  it("does not ask when there is no formatting to lose", () => {
    expect(shouldConfirmWholeDocument(false, plain)).toBe(false);
  });
});

/**
 * Regression for the citations data-loss bug: the AI result must be written
 * back into the range it was read from, never over the whole document.
 */
describe("applyScope — writing a result back into a selection", () => {
  function makeEditor(html: string) {
    return new Editor({ extensions: buildEditorExtensions(), content: html });
  }

  it("insertContentAt replaces only the selected range", () => {
    const editor = makeEditor(
      "<h1>باب اول</h1><p>پہلا پیراگراف</p><p>دوسرا پیراگراف</p>",
    );

    // Select exactly the text of the second paragraph.
    const target = "دوسرا پیراگراف";
    const full = editor.state.doc;
    let from = -1;
    full.descendants((node, pos) => {
      if (node.isText && node.text === target) from = pos;
    });
    expect(from).toBeGreaterThan(-1);
    const to = from + target.length;

    editor.chain().setTextSelection({ from, to }).insertContentAt({ from, to }, "دوسرا پیراگراف [صحيح البخاري 1]").run();

    const text = editor.getText();
    expect(text).toContain("باب اول");
    expect(text).toContain("پہلا پیراگراف");
    expect(text).toContain("[صحيح البخاري 1]");

    // The heading survived as a heading — this is what setContent() destroyed.
    expect(editor.getHTML()).toContain("<h1>");

    editor.destroy();
  });

  it("setContent over the whole document is what loses the rest — guarded by shouldConfirmWholeDocument", () => {
    const editor = makeEditor("<h1>باب اول</h1><p>پہلا پیراگراف</p>");
    expect(shouldConfirmWholeDocument(false, editor.getJSON())).toBe(true);

    editor.commands.setContent("<p>صرف یہ رہ گیا</p>");
    expect(editor.getText()).not.toContain("باب اول");

    editor.destroy();
  });
});
