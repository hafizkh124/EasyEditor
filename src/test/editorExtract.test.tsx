import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { buildEditorExtensions } from "@/components/editor/editorExtensions";

/**
 * SYSTEM-2026 §5 — extract text into the open document: the text goes in at
 * the cursor, which follows the user's own typing while the job runs.
 */

vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (k: string, fb?: string) => fb ?? k }),
}));
let gate = { audioAvailable: true, pagesAvailable: true, signedIn: true, desktop: false, sttRoute: "cloud", canAffordAudio: true, canAffordPage: true, pageEngine: "account", accept: "audio/*,image/*" };
vi.mock("@/lib/extract/useExtractGate", () => ({ useExtractGate: () => gate }));
vi.mock("@/lib/activityLog", () => ({ logActivity: vi.fn() }));
const toast = vi.hoisted(() => ({ loading: vi.fn(() => "t1"), success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

let release: (text: string) => void = () => {};
vi.mock("@/lib/extract/engine", async (orig) => ({
  ...(await orig<typeof import("@/lib/extract/engine")>()),
  runExtraction: vi.fn(() => new Promise((resolve) => { release = (text) => resolve({ text, segments: null }); })),
}));

import { useEditorExtract } from "@/components/editor/useEditorExtract";

describe("useEditorExtract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gate = { ...gate, canAffordPage: true };
  });

  it("inserts at the cursor, even after the user typed before it meanwhile", async () => {
    const editor = new Editor({ extensions: buildEditorExtensions(), content: "<p>اول</p><p>آخر</p>" });
    const { result } = renderHook(() => useEditorExtract(editor as never));
    const endOfFirst = 1 + "اول".length; // inside the first paragraph, at its end
    let job!: Promise<void>;
    act(() => {
      job = result.current.extractInto(new File(["x"], "page.png", { type: "image/png" }), endOfFirst);
    });
    // The user types at the start of the document while the job runs.
    editor.chain().insertContentAt(1, "نیا ").run();
    await act(async () => {
      release("نکالا گیا متن");
      await job;
    });
    const html = editor.getHTML();
    expect(html.indexOf("نیا اول")).toBeLessThan(html.indexOf("فائل سے: page.png"));
    expect(html.indexOf("نکالا گیا متن")).toBeLessThan(html.indexOf("آخر"));
    expect(toast.success).toHaveBeenCalled();
    editor.destroy();
  });

  it("refuses what cannot run here, before starting anything", async () => {
    gate = { ...gate, canAffordPage: false };
    const editor = new Editor({ extensions: buildEditorExtensions(), content: "<p>x</p>" });
    const { result } = renderHook(() => useEditorExtract(editor as never));
    await act(async () => {
      await result.current.extractInto(new File(["x"], "page.png", { type: "image/png" }));
    });
    expect(toast.error).toHaveBeenCalledWith("extract.limit_reached");
    expect(toast.loading).not.toHaveBeenCalled();
    editor.destroy();
  });
});
