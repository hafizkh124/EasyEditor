import { describe, it, expect, vi, beforeEach } from "vitest";
import { Editor } from "@tiptap/core";
import { buildEditorExtensions } from "@/components/editor/editorExtensions";
import { planDocumentChunks, MAX_BATCH_CHARS } from "@/lib/editor/docChunker";
import { trackRanges } from "@/lib/editor/positionTracker";
import { runChunkedTask, THROTTLE_MS } from "@/lib/tasks/chunkOrchestrator";
import * as aiActions from "@/lib/editor/aiActions";
import { taskRunService } from "@/core/workspace/taskRunService";

/**
 * SPEC-M3 Pillar D. These tests target the three ways a chunked run destroys a
 * scholar's work: overwriting structure it should not touch, firing past the
 * server's rate limit, and losing everything when the user cancels.
 */

function makeEditor(html: string) {
  return new Editor({ extensions: buildEditorExtensions(), content: html });
}

describe("planDocumentChunks (FR-5.1)", () => {
  it("never emits a batch covering a table or an image", () => {
    const editor = makeEditor(
      "<p>پہلا پیراگراف</p><table><tbody><tr><td>خانہ</td></tr></tbody></table><p>دوسرا پیراگراف</p>",
    );
    const plan = planDocumentChunks(editor);

    expect(plan.skipped).toBe(1);
    // The table's own range must not be inside any batch, or its result would
    // be written over the table and the table would be gone.
    const tableNode = editor.state.doc.child(1);
    expect(tableNode.type.name).toBe("table");
    for (const batch of plan.batches) {
      expect(batch.text).not.toContain("خانہ");
    }
    editor.destroy();
  });

  it("gives a heading its own inline batch so the node type survives", () => {
    const editor = makeEditor("<h2>باب اول</h2><p>متن</p>");
    const plan = planDocumentChunks(editor);

    const headingBatch = plan.batches.find((b) => b.text === "باب اول");
    expect(headingBatch).toBeDefined();
    expect(headingBatch!.mode).toBe("inline");
    // Inner range only: replacing [from, to] would delete the <h2> itself.
    expect(headingBatch!.from).toBeGreaterThan(0);
    editor.destroy();
  });

  it("groups consecutive paragraphs and keeps batches under the request cap", () => {
    const para = `<p>${"ا".repeat(3000)}</p>`;
    const editor = makeEditor(para.repeat(6));
    const plan = planDocumentChunks(editor);

    expect(plan.batches.length).toBeGreaterThan(1);
    for (const batch of plan.batches) {
      expect(batch.charCount).toBeLessThanOrEqual(MAX_BATCH_CHARS);
    }
    editor.destroy();
  });

  it("produces ascending, non-overlapping ranges inside the document", () => {
    const editor = makeEditor("<h1>عنوان</h1><p>ایک</p><p>دو</p><blockquote>اقتباس</blockquote>");
    const plan = planDocumentChunks(editor);

    let prevEnd = -1;
    for (const batch of plan.batches) {
      expect(batch.from).toBeGreaterThanOrEqual(prevEnd);
      expect(batch.to).toBeLessThanOrEqual(editor.state.doc.content.size);
      prevEnd = batch.to;
    }
    editor.destroy();
  });
});

describe("trackRanges (FR-5.2)", () => {
  it("shifts later ranges when an earlier batch is replaced with longer text", () => {
    // A heading and a paragraph produce two separate batches (consecutive
    // paragraphs would be grouped into one, leaving nothing to shift).
    const editor = makeEditor("<h1>عنوان</h1><p>ایک</p>");
    const plan = planDocumentChunks(editor);
    expect(plan.batches.length).toBe(2);

    const tracker = trackRanges(editor, plan.batches);
    const before = tracker.ranges[1].from;

    const heading = tracker.ranges[0];
    editor.commands.insertContentAt(
      { from: heading.from, to: heading.to },
      "ایک بہت زیادہ لمبا عنوان",
    );

    // The paragraph must move, or the next batch would be written into the
    // middle of someone else's sentence.
    expect(tracker.ranges[1].from).toBeGreaterThan(before);

    tracker.dispose();
    editor.destroy();
  });

  it("invalidates a range whose text the user deleted mid-run", () => {
    const editor = makeEditor("<h1>عنوان</h1><p>پیراگراف</p>");
    const plan = planDocumentChunks(editor);
    const tracker = trackRanges(editor, plan.batches);

    // The user deletes the paragraph while the run is in flight.
    const target = plan.batches[1];
    editor.commands.deleteRange({ from: target.from, to: target.to });

    expect(tracker.ranges[1].invalidated).toBe(true);
    tracker.dispose();
    editor.destroy();
  });
});

describe("runChunkedTask (FR-5.4 / FR-5.6 / FR-5.7)", () => {
  const batches = [0, 1, 2].map((i) => ({
    index: i,
    from: i * 10 + 1,
    to: i * 10 + 9,
    text: `batch ${i}`,
    mode: "block" as const,
    charCount: 8,
  }));

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(taskRunService, "createTaskRun").mockResolvedValue(null);
    vi.spyOn(taskRunService, "updateTaskRun").mockResolvedValue(true);
  });

  it("paces requests so a long run stays under the server's 30/min limit", async () => {
    vi.useFakeTimers();
    const stamps: number[] = [];
    vi.spyOn(aiActions, "callRefineTextDetailed").mockImplementation(async () => {
      stamps.push(Date.now());
      return { text: "ok", sources: [], confidence: null, model: null, tokensUsed: 5 };
    });

    const promise = runChunkedTask({
      taskSlug: "add_harakat",
      batches,
      accessToken: "t",
      applyBatch: () => true,
    });
    await vi.runAllTimersAsync();
    await promise;

    expect(stamps).toHaveLength(3);
    // Without pacing these gaps are ~0 and batch 31 of a real run gets a 429.
    expect(stamps[1] - stamps[0]).toBeGreaterThanOrEqual(THROTTLE_MS);
    expect(stamps[2] - stamps[1]).toBeGreaterThanOrEqual(THROTTLE_MS);
    vi.useRealTimers();
  });

  it("keeps every batch already applied when the run is cancelled", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const applied: number[] = [];

    vi.spyOn(aiActions, "callRefineTextDetailed").mockImplementation(async () => {
      // Cancel as soon as the first batch comes back.
      controller.abort();
      return { text: "ok", sources: [], confidence: null, model: null, tokensUsed: 5 };
    });

    const promise = runChunkedTask({
      taskSlug: "add_harakat",
      batches,
      accessToken: "t",
      signal: controller.signal,
      applyBatch: (i) => {
        applied.push(i);
        return true;
      },
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    // Cancelling must not throw away work that already reached the document.
    expect(result.cancelled).toBe(true);
    expect(applied).toEqual([0]);
    expect(result.applied).toBe(1);
    vi.useRealTimers();
  });

  it("continues after a failed batch instead of abandoning the run", async () => {
    vi.useFakeTimers();
    let call = 0;
    vi.spyOn(aiActions, "callRefineTextDetailed").mockImplementation(async () => {
      call++;
      if (call === 2) throw new Error("model unavailable");
      return { text: "ok", sources: [], confidence: null, model: null, tokensUsed: 5 };
    });

    const promise = runChunkedTask({
      taskSlug: "add_harakat",
      batches,
      accessToken: "t",
      applyBatch: () => true,
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.applied).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.partial).toBe(true);
    vi.useRealTimers();
  });

  it("stops paying once the wallet cannot cover the next batch", async () => {
    vi.useFakeTimers();
    vi.spyOn(aiActions, "callRefineTextDetailed").mockResolvedValue({
      text: "ok",
      sources: [],
      confidence: null,
      model: null,
      tokensUsed: 5,
    });

    const promise = runChunkedTask({
      taskSlug: "add_harakat",
      batches,
      accessToken: "t",
      availableTokens: 7, // enough for one batch (5), not two
      applyBatch: () => true,
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.applied).toBe(1);
    expect(result.tokensSpent).toBe(5);
    vi.useRealTimers();
  });

  // SPEC-M4 FR-1.2
  it("resumes from startIndex without redoing batches an earlier run applied", async () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    vi.spyOn(aiActions, "callRefineTextDetailed").mockImplementation(async (text: string) => {
      sent.push(text);
      return { text: "ok", sources: [], confidence: null, model: null, tokensUsed: 5 };
    });
    const applied: number[] = [];

    const promise = runChunkedTask({
      taskSlug: "add_harakat",
      batches,
      accessToken: "t",
      startIndex: 2,
      applyBatch: (index) => {
        applied.push(index);
        return true;
      },
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    // Only the third batch is re-sent, and it is applied at its ORIGINAL index
    // so the caller's range tracker still lines up.
    expect(sent).toEqual(["batch 2"]);
    expect(applied).toEqual([2]);
    // Progress counts the two batches the interrupted run already wrote.
    expect(result.applied).toBe(3);
    expect(result.tokensSpent).toBe(5);
    vi.useRealTimers();
  });
});
