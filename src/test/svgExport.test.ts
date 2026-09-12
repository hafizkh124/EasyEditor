// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { svgElementToString, svgElementToBlob, svgElementToPng, downloadBlob } from "@/lib/export/svgExport";

function makeSvg(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 100 50");
  const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  r.setAttribute("width", "10");
  svg.appendChild(r);
  return svg;
}

describe("svgExport", () => {
  it("serialises an <svg> with the xmlns and derived size", () => {
    const s = svgElementToString(makeSvg());
    expect(s).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(s).toContain('width="100"');
    expect(s).toContain("<rect");
  });

  it("svgElementToBlob is an image/svg+xml blob", () => {
    const b = svgElementToBlob(makeSvg());
    expect(b.type).toBe("image/svg+xml;charset=utf-8");
    expect(b.size).toBeGreaterThan(0);
  });

  it("downloadBlob clicks a temporary <a download>", () => {
    const click = vi.fn();
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = click;
    globalThis.URL.createObjectURL = vi.fn(() => "blob:x");
    globalThis.URL.revokeObjectURL = vi.fn();
    try {
      downloadBlob(new Blob(["x"]), "tree.svg");
      expect(click).toHaveBeenCalled();
    } finally {
      HTMLAnchorElement.prototype.click = orig;
    }
  });
});

// jsdom has no real image decoder / canvas 2d rasteriser — mock the pieces
// svgElementToPng touches (M12 Phase F, for ShareCard's PNG export).
describe("svgElementToPng (mocked canvas — real rasterisation is a manual/live check)", () => {
  let OrigImage: typeof Image;
  let drawImageCalls: unknown[][];
  let fillRectCalls: unknown[][];

  beforeEach(() => {
    globalThis.URL.createObjectURL = vi.fn(() => "blob:svg-src");
    globalThis.URL.revokeObjectURL = vi.fn();
    drawImageCalls = [];
    fillRectCalls = [];

    OrigImage = globalThis.Image;
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      width = 0;
      height = 0;
      set src(_v: string) {
        // Simulate async decode success on the next microtask.
        queueMicrotask(() => this.onload?.());
      }
    }
    // @ts-expect-error -- test double, not a full Image
    globalThis.Image = FakeImage;

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillStyle: "",
      fillRect: (...args: unknown[]) => { fillRectCalls.push(args); },
      drawImage: (...args: unknown[]) => { drawImageCalls.push(args); },
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => {
      cb?.(new Blob(["png-bytes"], { type: "image/png" }));
    });
  });

  afterEach(() => {
    globalThis.Image = OrigImage;
    vi.restoreAllMocks();
  });

  it("resolves a PNG blob, sized from the viewBox × scale", async () => {
    const svg = makeSvg(); // viewBox 0 0 100 50
    const blob = await svgElementToPng(svg, 2);
    expect(blob.type).toBe("image/png");
    expect(drawImageCalls[0]).toEqual([expect.anything(), 0, 0, 200, 100]);
    expect(fillRectCalls[0]).toEqual([0, 0, 200, 100]); // white background painted first
  });

  it("defaults scale to 2 when not given", async () => {
    await svgElementToPng(makeSvg());
    expect(drawImageCalls[0]).toEqual([expect.anything(), 0, 0, 200, 100]);
  });

  it("revokes the intermediate object URL even on success", async () => {
    await svgElementToPng(makeSvg(), 1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:svg-src");
  });

  it("rejects (and still revokes the URL) when the image fails to decode", async () => {
    class FailingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) { queueMicrotask(() => this.onerror?.()); }
    }
    // @ts-expect-error -- test double
    globalThis.Image = FailingImage;
    await expect(svgElementToPng(makeSvg(), 1)).rejects.toThrow(/rasterise/);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:svg-src");
  });
});
