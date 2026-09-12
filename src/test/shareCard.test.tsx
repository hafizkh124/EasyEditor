import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ShareCard } from "@/components/workspace/artifacts/ShareCard";

/**
 * M12 Phase F — the WhatsApp-shareable result card. Pure SVG (no <table>, no
 * <foreignObject> — svgElementToPng rasterises via `new Image()`, a context
 * that renders neither reliably), 1200×1200, hard-coded colours (a
 * standalone-serialised SVG has no access to the host page's CSS custom
 * properties), and the already-bundled Nastaliq font by family name.
 */

const table = {
  columns: ["مد", "رقم"],
  rows: [
    ["نقد", "100000"],
    ["سونا", "50000"],
  ],
  caption: "واجب الادا زکوٰۃ: 3750",
};

describe("ShareCard", () => {
  it("is a 1200×1200 SVG", () => {
    const { container } = render(<ShareCard title="حسابِ زکوٰۃ" table={table} footer="EasyEditor" />);
    const svg = container.querySelector("svg")!;
    expect(svg).toBeTruthy();
    expect(svg.getAttribute("viewBox")).toBe("0 0 1200 1200");
    expect(svg.getAttribute("width")).toBe("1200");
    expect(svg.getAttribute("height")).toBe("1200");
  });

  it("uses the Nastaliq font family, not a CSS class (no external stylesheet reaches a rasterised SVG)", () => {
    const { container } = render(<ShareCard title="س" footer="f" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("style") ?? "").toContain("Noto Nastaliq Urdu");
    expect(svg.getAttribute("class")).toBeFalsy();
  });

  it("renders the title and footer as <text>, and no <table>/<foreignObject> anywhere", () => {
    const { container } = render(<ShareCard title="حسابِ زکوٰۃ" footer="فوٹر متن" table={table} />);
    const texts = Array.from(container.querySelectorAll("text")).map((t) => t.textContent);
    expect(texts).toContain("حسابِ زکوٰۃ");
    expect(texts).toContain("فوٹر متن");
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("foreignObject")).toBeNull();
  });

  it("renders every column header and every cell of a small table", () => {
    const { container } = render(<ShareCard title="س" footer="f" table={table} />);
    const texts = Array.from(container.querySelectorAll("text")).map((t) => t.textContent);
    for (const col of table.columns) expect(texts).toContain(col);
    for (const row of table.rows) for (const cell of row) expect(texts).toContain(cell);
  });

  it("caps long tables at MAX_ROWS with a '+N more' row instead of overflowing the card", () => {
    const bigTable = {
      columns: ["وارث", "حصہ"],
      rows: Array.from({ length: 12 }, (_, i) => [`وارث ${i + 1}`, "1/12"]),
    };
    const { container } = render(<ShareCard title="س" footer="f" table={bigTable} />);
    // header row + at most MAX_ROWS data/overflow rows worth of <rect>s (one rect per row + border rects)
    const texts = Array.from(container.querySelectorAll("text")).map((t) => t.textContent ?? "");
    expect(texts.some((t) => t.includes("مزید"))).toBe(true);
    expect(texts).not.toContain("وارث 12"); // the last row was folded into the overflow indicator
  });

  it("truncates a long cell/column/title rather than overflowing its box", () => {
    const longTable = { columns: ["ایک بہت لمبا کالم کا نام جو فٹ نہیں ہوگا"], rows: [["ایک بہت لمبا سیل کی قیمت جو کبھی فٹ نہیں ہوگی"]] };
    const { container } = render(<ShareCard title="ایک بہت ہی لمبا عنوان جو کارڈ میں فٹ نہیں ہو سکتا" footer="f" table={longTable} />);
    const texts = Array.from(container.querySelectorAll("text")).map((t) => t.textContent ?? "");
    expect(texts.some((t) => t.endsWith("…"))).toBe(true);
    expect(texts.every((t) => t.length <= 32)).toBe(true);
  });

  it("falls back to wrapped plain text when there is no table", () => {
    const { container } = render(<ShareCard title="س" footer="f" text="یہ ایک لمبا خلاصہ ہے جس میں کئی الفاظ ہیں اور کارڈ پر کئی سطروں میں دکھایا جانا چاہیے۔" />);
    expect(container.querySelector("table")).toBeNull();
    const texts = Array.from(container.querySelectorAll("text")).map((t) => t.textContent ?? "");
    // more than just title+footer -> at least one wrapped body line was rendered
    expect(texts.length).toBeGreaterThan(2);
  });

  it("forwards the SVG ref (svgElementToPng needs a real SVGSVGElement)", () => {
    let ref: SVGSVGElement | null = null;
    render(<ShareCard title="س" footer="f" forwardRef={(el) => { ref = el; }} />);
    expect(ref).toBeInstanceOf(SVGSVGElement);
  });
});
