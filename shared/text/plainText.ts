/**
 * Tiptap JSON → plain text, and the word count derived from it.
 *
 * These live in shared/ because BOTH backends write the `plain_text` and
 * `word_count` columns. If the cloud and local implementations counted words
 * differently, the same document would report two different lengths depending
 * on where it was last saved — and every cost estimate derived from length
 * would disagree too.
 *
 * Pure TypeScript — no runtime APIs.
 */

/**
 * Walk a Tiptap JSON node tree, accumulating raw text.
 *
 * Deliberately does NOT trim: a paragraph is split into several text nodes
 * wherever a mark starts or ends (bold, italic, a link…), and the whitespace
 * separating the words lives at the edges of those nodes. Trimming per node
 * glued them together — "قال الإمام <b>مالك</b> رحمه الله" came back as
 * "قال الإماممالكرحمه الله". Trimming happens once, in the exported wrapper.
 */
function walkPlainText(node: Record<string, unknown>): string {
  let text = "";

  if (typeof node.text === "string") {
    text += node.text;
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      if (child && typeof child === "object") {
        text += walkPlainText(child as Record<string, unknown>);
        if (child.type === "paragraph" || child.type === "heading" || child.type === "listItem") {
          text += "\n";
        }
      }
    }
  }

  return text;
}

/** Extract clean plain text from a Tiptap JSON document node tree. */
export function extractPlainTextFromJSON(
  node: Record<string, unknown> | null | undefined,
): string {
  if (!node) return "";
  return walkPlainText(node).trim();
}

/** Word count used for the `word_count` column, derived from the plain text. */
export function countWords(plainText: string): number {
  return plainText ? plainText.split(/\s+/).filter(Boolean).length : 0;
}
