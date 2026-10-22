import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { MIN_SECTION_CHARS } from "~shared/agent/sectionSummaries";

/**
 * Block-aware chunking of a TipTap document (SPEC-M3 FR-5.1).
 *
 * Chunking plain text and writing the joined result back over the whole document
 * destroys everything the schema knew: headings become paragraphs, tables and
 * images vanish, list structure is gone. So batches are cut on *node* boundaries
 * and carry the document range they came from, which lets the orchestrator write
 * each result back into exactly the block it read.
 */

export type BatchMode = "inline" | "block" | "append";

export interface TextBatch {
  index: number;
  /** ProseMirror position, inclusive. */
  from: number;
  /** ProseMirror position, exclusive. */
  to: number;
  text: string;
  /**
   * "inline" — replace the block's *inner* range, so an <h2> stays an <h2>.
   * "block"  — replace the whole range with re-parsed paragraphs.
   * "append" — leave the range alone and insert the result after it
   *            (section summaries); `from`/`to` span the whole section.
   */
  mode: BatchMode;
  charCount: number;
}

export interface ChunkPlan {
  batches: TextBatch[];
  /** Blocks deliberately left untouched (tables, images, rules, code). */
  skipped: number;
}

/** Batch ceiling. `refine-text` rejects >12,000; the rest is prompt headroom. */
export const MAX_BATCH_CHARS = 8000;
/** Below this a block is merged forward rather than costing its own request. */
export const MIN_BATCH_CHARS = 400;

/** Node types that are never sent to the model and never overwritten. */
const SKIPPED_NODES = new Set(["table", "horizontalRule", "image", "codeBlock"]);

/** Blocks that must keep their own node type, so they are replaced inline. */
const STRUCTURAL_NODES = new Set([
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
]);

/** Sentence terminators — Urdu (۔؟) and Arabic (؟) alongside Latin. */
const SENTENCE_SPLIT = /(?<=[۔؟!?.])\s+/;

/**
 * Split one oversized block into inline sub-ranges at sentence boundaries.
 * The block itself is never removed, only its inner text is rewritten.
 */
function splitOversizedBlock(node: PMNode, offset: number, startIndex: number): TextBatch[] {
  const inner = node.textContent;
  const batches: TextBatch[] = [];
  // +1 skips the opening node token, so we address the block's inline content.
  let cursor = offset + 1;
  let index = startIndex;
  let buffer = "";
  let bufferStart = cursor;

  const flush = () => {
    if (!buffer.trim()) return;
    batches.push({
      index: index++,
      from: bufferStart,
      to: bufferStart + buffer.length,
      text: buffer,
      mode: "inline",
      charCount: buffer.length,
    });
  };

  for (const sentence of inner.split(SENTENCE_SPLIT)) {
    const piece = sentence + " ";
    if (buffer.length + piece.length > MAX_BATCH_CHARS && buffer) {
      flush();
      bufferStart = cursor;
      buffer = "";
    }
    buffer += piece;
    cursor += piece.length;
  }
  flush();

  return batches;
}

/**
 * Plan the batches for a document.
 *
 * Walks top-level blocks so every batch maps to a real range. Consecutive
 * paragraphs group together (their result re-parses cleanly as paragraphs);
 * headings, quotes and lists each get their own inline batch so their node type
 * survives; tables and images are counted and left alone.
 */
export function planDocumentChunks(editor: Editor): ChunkPlan {
  const doc = editor.state.doc;
  const batches: TextBatch[] = [];
  let skipped = 0;
  let index = 0;

  // Accumulator for a run of consecutive paragraphs.
  let groupFrom = -1;
  let groupTo = -1;
  let groupText = "";

  const flushGroup = () => {
    if (groupFrom < 0 || !groupText.trim()) {
      groupFrom = -1;
      groupText = "";
      return;
    }
    batches.push({
      index: index++,
      from: groupFrom,
      to: groupTo,
      text: groupText,
      mode: "block",
      charCount: groupText.length,
    });
    groupFrom = -1;
    groupText = "";
  };

  doc.forEach((node, offset) => {
    const from = offset;
    const to = offset + node.nodeSize;

    if (SKIPPED_NODES.has(node.type.name)) {
      flushGroup();
      skipped++;
      return;
    }

    const text = node.textContent;
    if (!text.trim()) {
      flushGroup();
      return;
    }

    if (STRUCTURAL_NODES.has(node.type.name)) {
      flushGroup();
      if (text.length > MAX_BATCH_CHARS) {
        const parts = splitOversizedBlock(node, offset, index);
        batches.push(...parts);
        index += parts.length;
      } else {
        batches.push({
          index: index++,
          // Inner range: keeps the heading/quote/list node itself intact.
          from: from + 1,
          to: to - 1,
          text,
          mode: "inline",
          charCount: text.length,
        });
      }
      return;
    }

    // Paragraph (or any other plain text block).
    if (text.length > MAX_BATCH_CHARS) {
      flushGroup();
      const parts = splitOversizedBlock(node, offset, index);
      batches.push(...parts);
      index += parts.length;
      return;
    }

    if (groupFrom >= 0 && groupText.length + text.length + 2 > MAX_BATCH_CHARS) {
      flushGroup();
    }
    if (groupFrom < 0) {
      groupFrom = from;
      groupText = text;
    } else {
      groupText += `\n\n${text}`;
    }
    groupTo = to;
  });

  flushGroup();

  return { batches: mergeTinyBatches(batches), skipped };
}

/** Merge a very short paragraph batch into the next one, to save a request. */
function mergeTinyBatches(batches: TextBatch[]): TextBatch[] {
  const out: TextBatch[] = [];

  for (const batch of batches) {
    const prev = out[out.length - 1];
    const mergeable =
      prev &&
      prev.mode === "block" &&
      batch.mode === "block" &&
      prev.charCount < MIN_BATCH_CHARS &&
      prev.to === batch.from &&
      prev.charCount + batch.charCount <= MAX_BATCH_CHARS;

    if (mergeable) {
      prev.to = batch.to;
      prev.text += `\n\n${batch.text}`;
      prev.charCount = prev.text.length;
      continue;
    }
    out.push({ ...batch });
  }

  return out.map((b, i) => ({ ...b, index: i }));
}

/** A section with less body text than this has nothing worth summarising. */
export { MIN_SECTION_CHARS };

/**
 * Plan a section-by-section summary (SYSTEM-2026: "حصوں کا خلاصہ").
 *
 * A section runs from a heading to the next heading of any level; text before
 * the first heading is a section of its own, and a document with no headings
 * is one section. Every batch is "append": the section is never rewritten, its
 * summary is inserted after it. A section longer than one request is sent in
 * parts that share the section's range, so their summaries land in order.
 * Tables, images and code are left out of the text, as they are everywhere.
 */
export function planSectionSummaries(editor: Editor): ChunkPlan {
  const doc = editor.state.doc;
  const batches: TextBatch[] = [];
  let skipped = 0;
  let index = 0;

  type Section = { from: number; to: number; heading: string; blocks: string[] };
  const sections: Section[] = [];
  let current: Section | null = null;

  doc.forEach((node, offset) => {
    const end = offset + node.nodeSize;
    if (node.type.name === "heading") {
      if (current) sections.push(current);
      current = { from: offset, to: end, heading: node.textContent.trim(), blocks: [] };
      return;
    }
    if (!current) current = { from: offset, to: end, heading: "", blocks: [] };
    current.to = end;
    if (SKIPPED_NODES.has(node.type.name)) {
      skipped++;
      return;
    }
    const text = node.textContent.trim();
    if (text) current.blocks.push(text);
  });
  if (current) sections.push(current);

  for (const section of sections) {
    const bodyLength = section.blocks.reduce((n, b) => n + b.length, 0);
    if (bodyLength < MIN_SECTION_CHARS) continue;

    // Group the section's blocks into request-sized parts. A single block
    // longer than a request is cut at sentence ends.
    const parts: string[] = [];
    let buffer = section.heading;
    const push = (piece: string) => {
      if (buffer && buffer.length + piece.length + 2 > MAX_BATCH_CHARS) {
        parts.push(buffer);
        buffer = section.heading;
      }
      buffer = buffer ? `${buffer}\n\n${piece}` : piece;
    };
    for (const block of section.blocks) {
      if (block.length <= MAX_BATCH_CHARS - section.heading.length - 2) {
        push(block);
        continue;
      }
      let sentenceRun = "";
      for (const sentence of block.split(SENTENCE_SPLIT)) {
        if (sentenceRun && sentenceRun.length + sentence.length + 1 > MAX_BATCH_CHARS / 2) {
          push(sentenceRun);
          sentenceRun = "";
        }
        sentenceRun = sentenceRun ? `${sentenceRun} ${sentence}` : sentence;
      }
      if (sentenceRun) push(sentenceRun);
    }
    if (buffer && buffer !== section.heading) parts.push(buffer);

    for (const text of parts) {
      batches.push({ index: index++, from: section.from, to: section.to, text, mode: "append", charCount: text.length });
    }
  }

  return { batches, skipped };
}

/** The plan a whole-document run of this task uses. */
export function planTaskChunks(editor: Editor, task: { applyMode: string } | undefined): ChunkPlan {
  return task?.applyMode === "append" ? planSectionSummaries(editor) : planDocumentChunks(editor);
}
