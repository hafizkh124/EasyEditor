/**
 * M9 Phase 7 — the renderer bridge for `ocr_document` (ADR-0023).
 *
 * OCR sends page images to the cloud `process-ocr` edge function — a signed-in
 * Supabase call the RENDERER makes — and pdf.js page rasterisation is a browser
 * API. So, like `transcribe_media` and `search_general`, the main-process agent
 * loop asks the renderer to do the work: it sends an `AGENT_PROGRESS` event with
 * `kind: 'ocr-request'` and waits for the reply on the `ocrResult` IPC action.
 *
 * The CONSENT gate is upstream of this (dispatch checks `session.ocrConsent`
 * before ever calling `requestOcr`), so by the time a request reaches the
 * renderer the scholar has already approved the upload for this project.
 *
 * Always resolves — a timeout resolves to a clear error, never rejects.
 */
import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import { logger } from '../lib/logger.js';
import { ALLOWED_IPC_CHANNELS } from '../ipc/registry.js';

const log = logger.child('agent/ocrBridge');

export interface OcrResult {
  /** One entry per page the renderer managed to read. */
  pages?: Array<{ page: number; text: string }>;
  error?: string;
}

interface Pending {
  resolve: (r: OcrResult) => void;
  timer: NodeJS.Timeout;
}

const pending = new Map<string, Pending>();
/** A scanned book can be dozens of pages, one cloud round-trip each. */
const OCR_TIMEOUT_MS = 20 * 60_000;

/**
 * Ask the renderer to OCR an in-project scan. `scanPath` is validated inside
 * the project jail by the dispatcher before this is called.
 */
export function requestOcr(
  runId: string,
  scanPath: string,
  lang: string,
  pages: string | undefined,
  sender: WebContents | null | undefined,
): Promise<OcrResult> {
  if (!sender || sender.isDestroyed()) {
    return Promise.resolve({ error: 'OCR is unavailable — the app window is gone.' });
  }
  const requestId = randomUUID();
  return new Promise<OcrResult>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      log.warn('OCR request timed out', { requestId, scanPath });
      resolve({ error: 'OCR did not finish in time — try a smaller page range.' });
    }, OCR_TIMEOUT_MS);
    pending.set(requestId, { resolve, timer });
    sender.send(ALLOWED_IPC_CHANNELS.AGENT_PROGRESS, {
      id: runId,
      kind: 'ocr-request',
      requestId,
      scanPath,
      lang,
      ...(pages ? { pages } : {}),
    });
  });
}

/** Called by the `ocrResult` IPC action when the renderer replies. */
export function resolveOcr(requestId: string, result: OcrResult): void {
  const p = pending.get(requestId);
  if (!p) {
    log.debug('OCR result for an unknown / expired request', { requestId });
    return;
  }
  clearTimeout(p.timer);
  pending.delete(requestId);
  p.resolve(result);
}
