/**
 * Plan §5.4 — export an SVG artifact (sanad-tree, matn-diff) as SVG or PNG.
 * Exporting a file the scholar explicitly asked for is a local render, not a
 * network download — no confirm.
 */

/** [w, h] from the `viewBox` attr (jsdom has no `svg.viewBox.baseVal`). */
function viewBoxSize(svg: SVGSVGElement): { w: number; h: number } | null {
  const vb = svg.getAttribute("viewBox");
  if (vb) {
    const p = vb.trim().split(/[\s,]+/).map(Number);
    if (p.length === 4 && p.every((n) => Number.isFinite(n))) return { w: p[2], h: p[3] };
  }
  const w = Number(svg.getAttribute("width")) || svg.clientWidth;
  const h = Number(svg.getAttribute("height")) || svg.clientHeight;
  return w && h ? { w, h } : null;
}

export function svgElementToString(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const size = viewBoxSize(svg);
  if (!clone.getAttribute("width") && size) {
    clone.setAttribute("width", String(size.w));
    clone.setAttribute("height", String(size.h));
  }
  return new XMLSerializer().serializeToString(clone);
}

export function svgElementToBlob(svg: SVGSVGElement): Blob {
  return new Blob([svgElementToString(svg)], { type: "image/svg+xml;charset=utf-8" });
}

/** Serialise → <img> → canvas → PNG blob. `scale` oversamples for crisp output. */
export async function svgElementToPng(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  const source = svgElementToString(svg);
  const vb = viewBoxSize(svg);
  const w = (vb?.w || svg.clientWidth || 800) * scale;
  const h = (vb?.h || svg.clientHeight || 600) * scale;

  const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    img.width = w;
    img.height = h;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("could not rasterise the SVG"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d canvas context");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))), "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
