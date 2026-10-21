import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { buildEditorExtensions } from "@/components/editor/editorExtensions";
import { planSectionSummaries, planTaskChunks, MAX_BATCH_CHARS } from "@/lib/editor/docChunker";
import { trackRanges } from "@/lib/editor/positionTracker";
import { sectionSummaryHtml, summaryLabel } from "@/lib/editor/sectionSummary";
import { getTaskBySlug } from "@/lib/tasks/registry";

/**
 * "حصوں کا خلاصہ" — one summary per section, inserted after it. The section
 * itself is never rewritten; that is the whole point of the fix.
 */

const long = (word: string) => `${word} `.repeat(60).trim() + "۔";

function makeEditor(html: string) {
  return new Editor({ extensions: buildEditorExtensions(), content: html });
}

describe("planSectionSummaries", () => {
  it("makes one append batch per section, heading first, covering the whole section", () => {
    const editor = makeEditor(`<h2>باب اول</h2><p>${long("زکوٰۃ")}</p><h2>باب دوم</h2><p>${long("نماز")}</p>`);
    const plan = planSectionSummaries(editor);
    expect(plan.batches).toHaveLength(2);
    expect(plan.batches.every((b) => b.mode === "append")).toBe(true);
    expect(plan.batches[0].text.startsWith("باب اول")).toBe(true);
    expect(plan.batches[1].text).toContain("نماز");
    expect(plan.batches[0].to).toBe(plan.batches[1].from);
    editor.destroy();
  });

  it("treats text before the first heading, or a document with no headings, as a section", () => {
    const editor = makeEditor(`<p>${long("مقدمہ")}</p>`);
    expect(planSectionSummaries(editor).batches).toHaveLength(1);
    editor.destroy();
  });

  it("skips a section too short to summarise, and leaves tables out of the text", () => {
    const editor = makeEditor(
      `<h2>عنوان</h2><p>مختصر</p><h2>دوسرا</h2><table><tbody><tr><td>خانہ</td></tr></tbody></table><p>${long("متن")}</p>`,
    );
    const plan = planSectionSummaries(editor);
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0].text).not.toContain("خانہ");
    expect(plan.skipped).toBe(1);
    editor.destroy();
  });

  it("sends a section longer than one request in parts that share its range", () => {
    const paragraphs = Array.from({ length: 4 }, () => `<p>${"لفظ ".repeat(800)}۔</p>`).join("");
    const editor = makeEditor(`<h2>طویل</h2>${paragraphs}`);
    const plan = planSectionSummaries(editor);
    expect(plan.batches.length).toBeGreaterThan(1);
    expect(plan.batches.every((b) => b.charCount <= MAX_BATCH_CHARS)).toBe(true);
    expect(new Set(plan.batches.map((b) => `${b.from}-${b.to}`)).size).toBe(1);
    editor.destroy();
  });

  it("is the plan the summary task uses", () => {
    const editor = makeEditor(`<h2>الف</h2><p>${long("متن")}</p>`);
    expect(planTaskChunks(editor, getTaskBySlug("summarize_sections")).batches[0].mode).toBe("append");
    expect(planTaskChunks(editor, getTaskBySlug("spelling_check")).batches[0].mode).not.toBe("append");
    editor.destroy();
  });
});

describe("inserting the summaries", () => {
  it("puts each summary right after its own section, leaving the text untouched", () => {
    const editor = makeEditor(`<h2>باب اول</h2><p>${long("زکوٰۃ")}</p><h2>باب دوم</h2><p>${long("نماز")}</p>`);
    const before = editor.getText();
    const plan = planSectionSummaries(editor);
    const tracker = trackRanges(editor, plan.batches);
    // Same call useChunkedRuns makes for an "append" batch, in run order.
    plan.batches.forEach((_, i) => {
      editor.chain().insertContentAt(tracker.ranges[i].to, sectionSummaryHtml(`- نکتہ ${i + 1}`)).run();
    });
    tracker.dispose();

    const types: string[] = [];
    // An empty paragraph after a quote at the very end is the editor's own
    // trailing node, so the writer can keep typing below the summary.
    editor.state.doc.forEach((node) => {
      if (!(node.type.name === "paragraph" && node.childCount === 0)) types.push(node.type.name);
    });
    expect(types).toEqual(["heading", "paragraph", "blockquote", "heading", "paragraph", "blockquote"]);
    expect(editor.state.doc.child(2).textContent).toContain("نکتہ 1");
    expect(editor.state.doc.child(5).textContent).toContain("نکتہ 2");
    // Every original word is still there.
    for (const word of before.split(/\s+/).filter(Boolean)) expect(editor.getText()).toContain(word);
    editor.destroy();
  });

  it("labels the summary in its own script and drops a label the model added", () => {
    expect(summaryLabel("یہ خلاصہ ہے")).toBe("خلاصہ");
    expect(summaryLabel("هذا ملخص")).toBe("خلاصة");
    expect(summaryLabel("A summary")).toBe("Summary");
    const html = sectionSummaryHtml("خلاصہ:\n- پہلا نکتہ");
    expect(html.match(/خلاصہ/g)).toHaveLength(1);
    expect(html).toContain("پہلا نکتہ");
  });
});
