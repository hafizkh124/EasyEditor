import type { Editor } from "@tiptap/react";
import type { Transaction } from "@tiptap/pm/state";
import type { TextBatch } from "./docChunker";

export interface LiveRange {
  from: number;
  to: number;
  /** Set when the user deleted the text this batch was planned for. */
  invalidated: boolean;
}

export interface RangeTracker {
  ranges: LiveRange[];
  dispose: () => void;
}

/**
 * Keep every planned batch range pointing at its own text while the document
 * changes underneath (SPEC-M3 FR-5.2).
 *
 * Two things move the ranges during a run: our own applies (each result is a
 * different length from the text it replaced) and the user typing while the run
 * proceeds. ProseMirror already solves both — every transaction carries a
 * mapping — so ranges are pushed through it rather than recomputed.
 *
 * Applying back-to-front would fix only the first problem, and would make the
 * progress bar count backwards.
 */
export function trackRanges(editor: Editor, batches: TextBatch[]): RangeTracker {
  const ranges: LiveRange[] = batches.map((b) => ({
    from: b.from,
    to: b.to,
    invalidated: false,
  }));

  const onTransaction = ({ transaction }: { transaction: Transaction }) => {
    if (!transaction.docChanged) return;
    for (const range of ranges) {
      if (range.invalidated) continue;
      // Bias -1/1 keeps the range "greedy": an insertion at either edge is
      // treated as inside it rather than pushing the boundary past it.
      range.from = transaction.mapping.map(range.from, -1);
      range.to = transaction.mapping.map(range.to, 1);
      if (range.to <= range.from) range.invalidated = true;
    }
  };

  editor.on("transaction", onTransaction);

  return {
    ranges,
    dispose: () => editor.off("transaction", onTransaction),
  };
}
