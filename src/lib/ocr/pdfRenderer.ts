// PDF page renderer for OCR.
//
// Uses pdf.js to render each page of a PDF to a JPEG image (base64), which is
// then sent to the existing Gemini-based OCR edge function.  Pages are rendered
// sequentially to keep memory bounded.

import * as pdfjsLib from "pdfjs-dist";
// Bundle the worker locally via Vite so its version always matches the
// installed pdfjs-dist (CDN URLs 404 when a version isn't mirrored).
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

export interface PdfPageResult {
  pageNum: number;
  totalPages: number;
  imageBase64: string;
  mimeType: string;
}

export interface RenderPdfOptions {
  /** DPI for rendering (default 216 = 3× 72-dpi CSS pixels for good OCR quality). */
  dpi?: number;
  /** JPEG quality 0–1 (default 0.85). */
  quality?: number;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

/**
 * Async generator that yields one rendered page at a time.
 * Each page is converted to a JPEG base64 string.
 */
export async function* renderPdfPages(
  file: File,
  options?: RenderPdfOptions,
): AsyncGenerator<PdfPageResult> {
  const dpi = options?.dpi ?? 216;
  const quality = options?.quality ?? 0.85;
  const signal = options?.signal;

  const arrayBuffer = await file.arrayBuffer();
  if (signal?.aborted) return;

  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const totalPages = pdf.numPages;

  for (let i = 1; i <= totalPages; i++) {
    if (signal?.aborted) return;

    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: dpi / 72 });

    // Render to a canvas.
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;

    await page.render({ canvas, canvasContext: ctx, viewport }).promise;

    // Convert to JPEG base64.
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    const base64 = dataUrl.split(",")[1];

    // Release resources for this page immediately.
    canvas.width = 0;
    canvas.height = 0;

    yield {
      pageNum: i,
      totalPages,
      imageBase64: base64,
      mimeType: "image/jpeg",
    };
  }
}

/** Get page count without rendering (for preview/validation). */
export async function getPdfPageCount(file: File): Promise<number> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  return pdf.numPages;
}
