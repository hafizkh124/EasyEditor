import type { Editor } from "@tiptap/react";
import { generateJSON } from "@tiptap/core";
import { buildEditorExtensions } from "@/components/editor/editorExtensions";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Apply AI / editor action result into the TipTap editor instance safely (FR-1.1).
 *
 * Uses `generateJSON` with `buildEditorExtensions()` schema so that headings,
 * blockquotes, lists, bold/italic marks, and tables are preserved verbatim instead
 * of being flattened into naive <p> tags.
 */
export function applyResult(
  editor: Editor,
  content: string,
  options?: {
    from?: number;
    to?: number;
    hasSelection?: boolean;
    isHtml?: boolean;
  },
): void {
  if (!editor || !content) return;

  const { from, to, hasSelection = false, isHtml = false } = options ?? {};

  // If content is already HTML or contains HTML tags, use as-is; otherwise convert paragraph newlines to <p>
  const htmlToParse =
    isHtml || /<[a-z][\s\S]*>/i.test(content)
      ? content
      : content
          .split(/\n{2,}/)
          .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
          .join("");

  try {
    const json = generateJSON(htmlToParse, buildEditorExtensions());

    if (hasSelection && typeof from === "number" && typeof to === "number" && to > from) {
      editor.chain().focus().insertContentAt({ from, to }, json).run();
    } else {
      editor.commands.setContent(json);
    }
  } catch (err) {
    console.error("[applyResult] Schema-safe JSON conversion failed, inserting content:", err);
    if (hasSelection && typeof from === "number" && typeof to === "number" && to > from) {
      editor.chain().focus().insertContentAt({ from, to }, content).run();
    } else {
      editor.commands.setContent(content);
    }
  }
}
