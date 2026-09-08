import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * M10 Phase 2.6 — exporters.ts's `exportDoc` now tries a real `.docx` via
 * docxExport.ts's htmlToDocxBlob first, falling back to the legacy
 * `.doc`-via-HTML export (exportDocLegacy) only if that returns null. Mocks
 * docxExport.ts itself — its own real conversion is covered end-to-end by
 * docxExport.test.ts; this file only pins the fallback DECISION.
 */
const htmlToDocxBlobMock = vi.fn();
vi.mock("@/lib/editor/docxExport", () => ({
  htmlToDocxBlob: (...args: unknown[]) => htmlToDocxBlobMock(...args),
}));

let downloads: Array<{ filename: string; type: string }> = [];

beforeEach(() => {
  downloads = [];
  htmlToDocxBlobMock.mockReset();
  // jsdom implements neither method at all (not merely differently) — a
  // plain assignment, not vi.spyOn, which needs an existing method to wrap.
  URL.createObjectURL = ((blob: Blob) => {
    downloads.push({ filename: "", type: blob.type });
    return "blob:mock-url";
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
  const realCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    const el = realCreateElement(tag);
    if (tag === "a") {
      const anchor = el as HTMLAnchorElement;
      // Never call the real click() — jsdom logs a "navigation not
      // implemented" error for a real anchor click, harmless but noisy.
      // Reading `.download` (already set by triggerDownload before click())
      // is all this test needs.
      anchor.click = () => {
        if (downloads.length) downloads[downloads.length - 1].filename = anchor.download;
      };
    }
    return el;
  }) as typeof document.createElement);
});

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error -- undoing the plain assignment above; jsdom never had these.
  delete URL.createObjectURL;
  // @ts-expect-error -- see above.
  delete URL.revokeObjectURL;
});

describe("exportDoc — real .docx first, legacy .doc fallback", () => {
  it("downloads a real .docx when htmlToDocxBlob succeeds", async () => {
    const { exportDoc } = await import("@/lib/editor/exporters");
    htmlToDocxBlobMock.mockResolvedValue(new Blob(["fake docx bytes"], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
    await exportDoc("<p>hi</p>", "My Report");
    expect(downloads).toHaveLength(1);
    expect(downloads[0].filename).toBe("My Report.docx");
    expect(downloads[0].type).toContain("wordprocessingml");
  });

  it("falls back to the legacy .doc export when htmlToDocxBlob returns null", async () => {
    const { exportDoc } = await import("@/lib/editor/exporters");
    htmlToDocxBlobMock.mockResolvedValue(null);
    await exportDoc("<p>hi</p>", "My Report");
    expect(downloads).toHaveLength(1);
    expect(downloads[0].filename).toBe("My Report.doc");
    expect(downloads[0].type).toContain("application/msword");
  });

  it("passes suggestion-stripped HTML to htmlToDocxBlob, not the raw editor markup", async () => {
    const { exportDoc } = await import("@/lib/editor/exporters");
    htmlToDocxBlobMock.mockResolvedValue(new Blob(["x"], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
    await exportDoc('<p>kept <del data-change-id="1">removed</del><ins data-change-id="1">added</ins></p>', "T");
    const [passedHtml] = htmlToDocxBlobMock.mock.calls[0];
    expect(passedHtml).not.toContain("removed");
    expect(passedHtml).toContain("added");
  });
});
