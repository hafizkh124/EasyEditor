import { describe, it, expect } from "vitest";
import { readSource } from "./sourceScan";

/**
 * M10 Phase 3 — broader touch-target sweep. ~30 small (24-36px) icon-only
 * `Button size="icon"` sites across the app's chrome had no `min-h-touch
 * min-w-touch` below `md`, unlike the handful WorkbenchPanel/ReaderToolbar
 * already carried. This doesn't re-verify every single site (that's what
 * the sweep itself, and each component's own test file, already covers) —
 * it spot-checks a representative cross-section of the most-visible ones
 * named in the plan, via the same "grep the committed source" pattern
 * pwaManifest.test.ts and uiDiscipline.test.ts already use, so a future
 * edit that drops the touch-target classes on one of these specific
 * high-traffic controls fails a real test, not just a design review.
 */
describe("touch-target sweep — representative sites carry min-h-touch/min-w-touch", () => {
  it("EditorToolbar's formatting buttons", () => {
    const src = readSource(`${process.cwd()}/src/components/editor/EditorToolbar.tsx`);
    // Every h-8 w-8 p-0 icon button in this file should carry the touch classes.
    const iconButtonLines = src.split("\n").filter((l) => /\bh-8 w-8\b/.test(l));
    expect(iconButtonLines.length).toBeGreaterThan(0);
    for (const line of iconButtonLines) {
      expect(line, `line missing touch target: ${line.trim()}`).toMatch(/min-h-touch/);
    }
  });

  it("WorkspaceTopBar's back/copy/language/overflow buttons", () => {
    const src = readSource(`${process.cwd()}/src/components/workspace/WorkspaceTopBar.tsx`);
    const iconButtonLines = src.split("\n").filter((l) => /size="icon"/.test(l) && /\bh-8 w-8\b/.test(l));
    expect(iconButtonLines.length).toBeGreaterThan(0);
    for (const line of iconButtonLines) {
      expect(line, `line missing touch target: ${line.trim()}`).toMatch(/min-h-touch/);
    }
  });

  it("LibraryPanel's expand/collapse/add buttons", () => {
    const src = readSource(`${process.cwd()}/src/components/workspace/LibraryPanel.tsx`);
    const iconButtonLines = src.split("\n").filter((l) => /size="icon"/.test(l) && /\bh-[78] w-[78]\b/.test(l));
    expect(iconButtonLines.length).toBeGreaterThan(0);
    for (const line of iconButtonLines) {
      expect(line, `line missing touch target: ${line.trim()}`).toMatch(/min-h-touch/);
    }
  });

  it("PdfViewerDialog's prev/next/zoom/close controls", () => {
    const src = readSource(`${process.cwd()}/src/components/shamela/PdfViewerDialog.tsx`);
    const iconButtonLines = src.split("\n").filter((l) => /size="icon"/.test(l) && /\bh-8 w-8\b/.test(l));
    expect(iconButtonLines).toHaveLength(5);
    for (const line of iconButtonLines) {
      expect(line, `line missing touch target: ${line.trim()}`).toMatch(/min-h-touch/);
    }
  });

  it("AgentComposer's hub/mic/cancel/send controls", () => {
    const src = readSource(`${process.cwd()}/src/components/workspace/AgentComposer.tsx`);
    const iconButtonLines = src.split("\n").filter((l) => /\bh-9 w-9\b/.test(l));
    expect(iconButtonLines.length).toBeGreaterThan(0);
    for (const line of iconButtonLines) {
      expect(line, `line missing touch target: ${line.trim()}`).toMatch(/min-h-touch/);
    }
  });

  it("ProjectFolderSection's refresh/change/close controls", () => {
    const src = readSource(`${process.cwd()}/src/components/workspace/ProjectFolderSection.tsx`);
    const iconButtonLines = src.split("\n").filter((l) => /\bh-6 w-6\b/.test(l));
    expect(iconButtonLines).toHaveLength(3);
    for (const line of iconButtonLines) {
      expect(line, `line missing touch target: ${line.trim()}`).toMatch(/min-h-touch/);
    }
  });
});
