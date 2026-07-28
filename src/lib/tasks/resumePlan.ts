import { computeDocHash } from "@/utils/docHash";
import type { TextBatch } from "@/lib/editor/docChunker";

/** One planned batch, as persisted in `task_runs.input.batch_plan`. */
export interface StoredBatchPlan {
  index: number;
  charCount: number;
  /** Hash of the batch's text as it was when the run was planned. */
  hash: string;
}

export function buildBatchPlan(batches: TextBatch[]): StoredBatchPlan[] {
  return batches.map((b) => ({
    index: b.index,
    charCount: b.charCount,
    hash: computeDocHash(b.text),
  }));
}

/**
 * Can an interrupted run be picked up where it stopped (SPEC-M4 FR-1.2)?
 *
 * A hash of the whole document is the wrong question to ask here: the run
 * itself rewrites the document as it goes, so after batch 1 lands the document
 * no longer matches what it hashed to at run start, and resume would never be
 * offered. What actually has to be unchanged is the *tail* the run never
 * reached — batches `done..end`. Those are compared batch by batch against the
 * plan stored when the run started.
 *
 * Anything unexpected (missing plan, re-chunked to a different shape, edited
 * tail) returns false. The user is then offered a fresh run instead — never a
 * guess at where the old one belonged (SPEC-M3 FR-5.2).
 */
export function canResumeRun(
  stored: StoredBatchPlan[] | undefined | null,
  done: number,
  current: TextBatch[],
): boolean {
  if (!Array.isArray(stored) || stored.length === 0) return false;
  if (!Number.isInteger(done) || done < 0) return false;
  // Nothing left to do, or a count that cannot be trusted.
  if (done >= stored.length) return false;
  // Re-chunking produced a different shape ⇒ the document changed structurally.
  if (current.length !== stored.length) return false;

  for (let i = done; i < stored.length; i++) {
    const plan = stored[i];
    const batch = current[i];
    if (!batch || !plan) return false;
    if (plan.index !== batch.index) return false;
    if (typeof plan.hash !== "string") return false;
    if (plan.hash !== computeDocHash(batch.text)) return false;
  }

  return true;
}
