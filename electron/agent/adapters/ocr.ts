/**
 * M9 Phase 7 — `ocr_document`'s main-process half (ADR-0023).
 *
 * The OCR itself is NOT done here. It sends page images to the cloud
 * `process-ocr` edge function, which is a signed-in Supabase call the RENDERER
 * makes — and pdf.js page rendering is a browser API. So this asks the renderer
 * to run that (the same bridge pattern as `transcribe_media` / `search_general`)
 * and turns the per-page text it gets back into one plain-text file inside the
 * project folder, page-delimited so a proofreader can line it up with the scan.
 *
 * The output is a MACHINE READING with errors. Nothing here is citable, and a
 * chapter seeded from it must be labelled unverified.
 */
import path from 'node:path';
import { logger } from '../../lib/logger.js';
import { writeAssetText } from '../../fs/projectFolder.js';

const log = logger.child('agent/ocr');

export interface OcrPageLike { page: number; text: string }

/** One page's block in the transcript file — the marker a proofreader scans for. */
export function formatOcrText(pages: OcrPageLike[]): string {
  return pages
    .filter((p) => p.text.trim().length > 0)
    .map((p) => `──── صفحہ ${p.page} ────\n${p.text.trim()}`)
    .join('\n\n');
}

/** The in-project path a scan's OCR text is written to. */
export function ocrTextPathFor(scanPath: string): string {
  const base = path.basename(scanPath).replace(/\.[^.]+$/, '');
  return `sources/${base}.ocr.txt`;
}

export interface OcrOutcome {
  ocrPath: string;
  pageCount: number;
  text: string;
}

/** Write the OCR text into the project folder and report where it landed. */
export function saveOcrText(
  root: string,
  scanPath: string,
  pages: OcrPageLike[],
): OcrOutcome {
  const text = formatOcrText(pages);
  const rel = ocrTextPathFor(scanPath);
  writeAssetText(root, rel, text);
  const pageCount = pages.filter((p) => p.text.trim().length > 0).length;
  log.info('OCR text saved', { rel, pageCount });
  return { ocrPath: rel, pageCount, text };
}
