import { ACCEPTED_MEDIA, MAX_FILE_SIZE_BYTES } from "@/lib/audio/formatSupport";
import {
  transcribeLongForm, TranscribeCancelledError, MAX_DURATION_SECONDS,
  type SttRoute, type TranscribeLanguage,
} from "@/lib/audio/transcribeLongForm";
import { MAX_PDF_PAGES, getDocumentType, getMaxFileSize } from "@/lib/ocr/documentFormats";
import { renderPdfPages, getPdfPageCount } from "@/lib/ocr/pdfRenderer";
import { ocrPageImage } from "@/lib/ocr/ocrClient";
import type { TranscriptSegment } from "@/core/voice/types";
import type { TranslationKey } from "@/lib/i18n";

/**
 * The extract-text engine (SYSTEM-2026 §5), shared by the Extract screen and
 * the editor's "extract here": what a file is, whether it may run, and the
 * run itself. No UI — callers show progress and errors their own way.
 */

export type ExtractKind = "audio" | "image" | "pdf";

const AUDIO_EXT = new Set(
  ACCEPTED_MEDIA.split(",").filter((x) => x.startsWith(".")).map((x) => x.toLowerCase()),
);

/** What kind of extraction a file needs, or null when it is neither media nor a page. */
export function detectKind(file: File): ExtractKind | null {
  const doc = getDocumentType(file);
  if (doc === "image" || doc === "pdf") return doc;
  if (file.type.startsWith("audio/") || file.type.startsWith("video/")) return "audio";
  const dot = file.name.lastIndexOf(".");
  return dot >= 0 && AUDIO_EXT.has(file.name.slice(dot).toLowerCase()) ? "audio" : null;
}

export interface ExtractGate {
  audioAvailable: boolean;
  pagesAvailable: boolean;
  signedIn: boolean;
  desktop: boolean;
  sttRoute: SttRoute;
  canAffordAudio: boolean;
  canAffordPage: boolean;
}

/** Why this file cannot be extracted here, as a message key — or null when it can. */
export function blockReason(file: File, kind: ExtractKind | null, gate: ExtractGate): TranslationKey | null {
  if (!kind || (kind === "audio" ? !gate.audioAvailable : !gate.pagesAvailable)) return "extract.unsupported";
  if (kind === "audio") {
    if (file.size > MAX_FILE_SIZE_BYTES) return "stt.file_too_large";
    // A signed-out desktop has no cloud account: only local Whisper can run.
    if (gate.desktop && gate.sttRoute === "cloud" && !gate.signedIn) return "extract.needs_local_model";
    if (gate.sttRoute === "cloud" && !gate.canAffordAudio) return "extract.limit_reached";
    return null;
  }
  if (file.size > getMaxFileSize(kind)) return "extract.file_too_large";
  if (!gate.signedIn) return "extract.sign_in_for_pages";
  if (!gate.canAffordPage) return "extract.limit_reached";
  return null;
}

export class TooManyPagesError extends Error {
  constructor(readonly limit = MAX_PDF_PAGES) {
    super(`PDF has more than ${limit} pages`);
  }
}

export interface ExtractProgress {
  labelKey: TranslationKey;
  current: number;
  total: number;
  /** The text so far, for showing a long job as it grows. */
  partial?: string;
}

function readBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function runExtraction({
  file, kind, language, sttRoute, signal, onProgress, pageLabel = "Page",
}: {
  file: File;
  kind: ExtractKind;
  language: TranscribeLanguage;
  sttRoute: SttRoute;
  signal: AbortSignal;
  onProgress?: (p: ExtractProgress) => void;
  /** The word for page markers in a multi-page result ("صفحہ"). */
  pageLabel?: string;
}): Promise<{ text: string; segments: TranscriptSegment[] | null }> {
  if (kind === "audio") {
    onProgress?.({ labelKey: "extract.progress_audio", current: 0, total: 0 });
    const result = await transcribeLongForm({
      file,
      language,
      route: sttRoute,
      signal,
      onProgress: (ev) =>
        onProgress?.({ labelKey: "extract.progress_audio", current: ev.current ?? 0, total: ev.total ?? 0, partial: ev.partialTranscript || undefined }),
    });
    return { text: result.text, segments: result.segments ?? null };
  }

  if (kind === "image") {
    onProgress?.({ labelKey: "extract.progress_page", current: 1, total: 1 });
    return { text: await ocrPageImage(await readBase64(file), file.type || "image/jpeg"), segments: null };
  }

  const total = await getPdfPageCount(file);
  if (total > MAX_PDF_PAGES) throw new TooManyPagesError();
  const pages: string[] = [];
  for await (const page of renderPdfPages(file, { signal })) {
    if (signal.aborted) throw new TranscribeCancelledError();
    onProgress?.({ labelKey: "extract.progress_page", current: page.pageNum, total: page.totalPages, partial: pages.join("\n\n") || undefined });
    const pageText = await ocrPageImage(page.imageBase64, page.mimeType);
    pages.push(total > 1 ? `--- ${pageLabel} ${page.pageNum} ---\n${pageText}` : pageText);
    onProgress?.({ labelKey: "extract.progress_page", current: page.pageNum, total: page.totalPages, partial: pages.join("\n\n") });
  }
  return { text: pages.join("\n\n"), segments: null };
}

/** A failed run as a message key, or the engine's own message; null when it was cancelled. */
export function describeFailure(err: unknown, signal: AbortSignal): { key: TranslationKey; replace?: [string, string] } | { message: string } | null {
  if (err instanceof TranscribeCancelledError || signal.aborted) return null;
  if (err instanceof TooManyPagesError) return { key: "extract.too_many_pages", replace: ["{n}", String(err.limit)] };
  const msg = err instanceof Error ? err.message : "";
  if (msg.includes("minute maximum") || msg.includes(`${MAX_DURATION_SECONDS / 60}-minute`)) return { key: "stt.too_long" };
  if (msg.includes("cannot decode")) return { key: "stt.format_unsupported" };
  if (/429|limit/i.test(msg)) return { key: "extract.limit_reached" };
  return msg ? { message: msg } : { key: "extract.failed" };
}
