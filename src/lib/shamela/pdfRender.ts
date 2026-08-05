/**
 * SPEC-M6 Phase 10 — render one page of a Shamela PDF to a raster image.
 *
 * Used for book covers (page 1 or the `pdf_links.cover` page). Kept separate
 * from the OCR pipeline's pdfRenderer so a cover render never drags the OCR
 * module into the library chunks. pdfjs runs off-thread in its own worker; we
 * only decode the bytes already read via the native bridge.
 */

import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
// Bundle the worker locally via Vite so its version always matches the
// installed pdfjs-dist (CDN URLs 404 when a version isn't mirrored).
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

/** Open a PDF entirely in memory from already-read bytes. */
export function openPdfDocument(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return pdfjsLib.getDocument({ data: bytes }).promise;
}

export interface PdfPageRenderResult {
  numPages: number;
  width: number;
  height: number;
}

/**
 * Render one page of an already-open document into a canvas. The canvas is
 * sized to `targetWidth` CSS pixels (aspect ratio preserved) and the raster
 * matches so it stays crisp on hidpi screens.
 */
export async function renderPdfPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  targetWidth: number,
): Promise<PdfPageRenderResult> {
  const page = await pdf.getPage(Math.min(pageNumber, pdf.numPages));
  const base = page.getViewport({ scale: 1 });
  const scale = targetWidth / base.width;
  const viewport = page.getViewport({ scale });

  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return { numPages: pdf.numPages, width: viewport.width, height: viewport.height };
}

/**
 * Render a single page to a JPEG data URL. `maxWidth` scales the raster down
 * so a catalogue full of covers stays light on memory.
 */
export async function renderPdfCoverPage(
  bytes: Uint8Array,
  pageNumber: number,
  maxWidth = 220,
  quality = 0.82,
): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  try {
    const page = await pdf.getPage(Math.min(pageNumber, pdf.numPages));
    const base = page.getViewport({ scale: 1 });
    const scale = maxWidth / base.width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");

    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    await pdf.destroy();
  }
}
