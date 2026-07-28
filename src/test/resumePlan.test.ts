import { describe, it, expect } from "vitest";
import { buildBatchPlan, canResumeRun } from "@/lib/tasks/resumePlan";
import type { TextBatch } from "@/lib/editor/docChunker";

/**
 * SPEC-M4 FR-1.2 — resuming a run a reload interrupted.
 *
 * The invariant deliberately is NOT "the document is unchanged": the run
 * rewrites the document as it goes, so that check can never pass after the
 * first batch lands. What must be unchanged is the tail the run never reached.
 */

const batch = (index: number, text: string): TextBatch => ({
  index,
  text,
  from: index * 100,
  to: index * 100 + text.length,
  charCount: text.length,
  mode: "block",
});

const PLANNED: TextBatch[] = [
  batch(0, "پہلا پیراگراف"),
  batch(1, "دوسرا پیراگراف"),
  batch(2, "تیسرا پیراگراف"),
  batch(3, "چوتھا پیراگراف"),
];

const stored = buildBatchPlan(PLANNED);

describe("canResumeRun (SPEC-M4 FR-1.2)", () => {
  it("resumes when the untouched tail still matches the plan", () => {
    // Batches 0–1 already applied, so their text is now the AI's output.
    const afterTwoBatches: TextBatch[] = [
      batch(0, "پہلا پیراگراف (تبدیل شدہ)"),
      batch(1, "دوسرا پیراگراف (تبدیل شدہ)"),
      PLANNED[2],
      PLANNED[3],
    ];

    expect(canResumeRun(stored, 2, afterTwoBatches)).toBe(true);
  });

  it("refuses when the user edited a batch the run had not reached", () => {
    const tailEdited: TextBatch[] = [
      PLANNED[0],
      PLANNED[1],
      batch(2, "تیسرا پیراگراف — صارف نے بدل دیا"),
      PLANNED[3],
    ];

    expect(canResumeRun(stored, 2, tailEdited)).toBe(false);
  });

  it("refuses when re-chunking produced a different number of batches", () => {
    expect(canResumeRun(stored, 2, PLANNED.slice(0, 3))).toBe(false);
  });

  it("refuses when the run has no batches left", () => {
    expect(canResumeRun(stored, PLANNED.length, PLANNED)).toBe(false);
  });

  it("refuses on a missing, empty, or malformed stored plan", () => {
    expect(canResumeRun(undefined, 1, PLANNED)).toBe(false);
    expect(canResumeRun([], 0, PLANNED)).toBe(false);
    expect(canResumeRun([{ index: 0, charCount: 5 }] as never, 0, PLANNED)).toBe(false);
  });

  it("refuses a negative or non-integer done count", () => {
    expect(canResumeRun(stored, -1, PLANNED)).toBe(false);
    expect(canResumeRun(stored, 1.5, PLANNED)).toBe(false);
  });

  it("survives the document being rewritten ahead of the resume point", () => {
    // The whole point: batch 0 changed, and resume from index 1 is still safe.
    const rewritten: TextBatch[] = [batch(0, "بالکل نیا متن"), PLANNED[1], PLANNED[2], PLANNED[3]];
    expect(canResumeRun(stored, 1, rewritten)).toBe(true);
  });
});
