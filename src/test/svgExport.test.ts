// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { svgElementToString, svgElementToBlob, downloadBlob } from "@/lib/export/svgExport";

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
