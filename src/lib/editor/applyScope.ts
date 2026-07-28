/**
 * Deciding *where* an AI action is allowed to write.
 *
 * The refine-text actions send plain text and get plain text back, so applying
 * a result to the whole document flattens it: headings, blockquotes, lists,
 * tables and inline marks are all replaced by bare paragraphs. That is fine for
 * an unformatted draft and destructive for a finished chapter, so the caller
 * asks first — but only when there is actually something to lose.
 */

/** Node types that carry structure a plain-text round-trip cannot rebuild. */
const RICH_NODE_TYPES = new Set([
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  "codeBlock",
  "horizontalRule",
  "image",
]);

interface JsonNode {
  type?: string;
  marks?: Array<{ type?: string }>;
  content?: unknown;
  [k: string]: unknown;
}

/**
 * True when a Tiptap document contains structure or inline marks that a
 * plain-text replacement would destroy.
 */
export function hasRichFormatting(node: JsonNode | null | undefined): boolean {
  if (!node || typeof node !== "object") return false;

  if (node.type && RICH_NODE_TYPES.has(node.type)) return true;
  if (Array.isArray(node.marks) && node.marks.length > 0) return true;

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      if (hasRichFormatting(child as JsonNode)) return true;
    }
  }

  return false;
}

/**
 * Should the user confirm before this action runs?
 *
 * Only when it would rewrite the entire document *and* that document has
 * formatting worth keeping. With a selection the rest of the document is
 * untouched, so no confirmation is needed.
 */
export function shouldConfirmWholeDocument(
  hasSelection: boolean,
  doc: JsonNode | null | undefined,
): boolean {
  if (hasSelection) return false;
  return hasRichFormatting(doc);
}
