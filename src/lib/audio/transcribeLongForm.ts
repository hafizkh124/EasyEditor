// Long-form transcription orchestrator (SPEC-v2 §FR-3).
//
// Decodes the audio file, slices it into ~5-minute chunks, sends each chunk to
// the existing stateless `transcribe` edge function, and reassembles the text in
// order. Emits phased progress events and supports cancellation via AbortSignal.

import { callEdgeFunction } from "@/core/ai/aiAdapter";
import { decodeAudioFile, chunkAudioBuffer, encodeChunkToWav, blobToDataUrl, type AudioChunk } from "./chunker";
import { isVideoFile } from "./formatSupport";
import { isDesktop } from "@/utils/environment";
import { getPreferredSttEngine } from "@/core/voice/registry";
import { LocalSttEngine } from "@/core/voice/localEngines";
import type { TranscriptSegment } from "@/core/voice/types";

export const MAX_DURATION_SECONDS = 120 * 60; // FR-3.1: 120-minute (2-hour) hard cap
export const CHUNK_THRESHOLD_SECONDS = 300;  // files longer than this are auto-chunked

export type ProgressPhase = "extracting" | "decoding" | "preparing" | "transcribing" | "finalizing";

export interface ProgressEvent {
  phase: ProgressPhase;
  /** 1-based index of the current chunk being processed (transcribing phase only). */
  current?: number;
  /** Total chunk count (transcribing phase only). */
  total?: number;
  /** Cumulative transcript so far (incrementally updated as chunks complete). */
  partialTranscript?: string;
}

export type TranscribeLanguage = "auto" | "en-US" | "ur-PK" | "ar" | "pa" | "ps" | "fa" | "sd" | "bal";

export interface LongFormTranscribeArgs {
  file: Blob;
  language: TranscribeLanguage;
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
  /** Backend to use. Resolved with `resolveSttRoute` when omitted. */
  route?: SttRoute;
  /**
   * Chunks finished before an interruption, by index — reused instead of
   * transcribed (and paid for) again when a job resumes (SYSTEM-2026 §9).
   * Chunking is deterministic for the same file, so the indices line up.
   */
  doneChunks?: Readonly<Record<number, ChunkTranscript>>;
  /** Called as each chunk finishes, so a job can keep it for resuming. */
  onChunkDone?: (index: number, chunk: ChunkTranscript) => void;
}

export interface ChunkTranscript {
  text: string;
  segments?: TranscriptSegment[];
}

export interface LongFormTranscribeResult {
  text: string;
  durationSeconds: number;
  chunkCount: number;
  /** Which backend produced the transcript. */
  route: SttRoute;
  /**
   * Timestamped segments covering the whole file, with times made absolute.
   * Undefined when the engine has no timestamps (FR-6.3: the subtitle buttons
   * must be disabled in that case, never write an empty file).
   */
  segments?: TranscriptSegment[];
  /**
   * Each chunk's text with the stretch of the file it covers — always
   * present, whichever engine ran. The cloud gives no times inside a chunk,
   * so this is what an approximate read-along is built from.
   */
  chunkSpans: TranscriptSegment[];
}

export class TranscribeCancelledError extends Error {
  constructor() {
    super("Transcription cancelled");
    this.name = "TranscribeCancelledError";
  }
}

function checkSignal(signal?: AbortSignal): void {
  if (signal?.aborted) throw new TranscribeCancelledError();
}

/** Which transcription backend a run will use. Decided once, before chunking. */
export type SttRoute = "local" | "cloud";

/** A chunk's transcript, plus timestamps when the engine provides them. */
interface ChunkResult {
  text: string;
  /** Times relative to the start of the chunk; absent on engines without timestamps. */
  segments?: TranscriptSegment[];
}

/**
 * SPEC-M5 FR-6.2/FR-6.8: on the desktop, transcription can run locally for free.
 * Resolved once per run rather than per chunk, so a run can never switch engines
 * half way through — and only when a Whisper model is actually downloaded, so the
 * local route is never chosen just to fail on chunk one.
 */
export async function resolveSttRoute(): Promise<SttRoute> {
  if (!isDesktop()) return "cloud";
  if (getPreferredSttEngine() === "cloud") return "cloud";
  try {
    const models = await window.electronAPI?.voice?.getModels?.();
    const hasWhisper = (models ?? []).some((m) => m.engine === "whisper" && m.downloaded);
    return hasWhisper ? "local" : "cloud";
  } catch {
    return "cloud";
  }
}

async function transcribeChunkLocally(
  wav: Blob,
  language: TranscribeLanguage,
): Promise<ChunkResult> {
  const engine = new LocalSttEngine();
  // 'auto' is whisper.cpp's own language-detection value (FR-6.10), so it is
  // passed through rather than mapped.
  const segments = await engine.transcribeBuffer(await wav.arrayBuffer(), language);
  return {
    text: segments.map((s) => s.text).join(" ").trim(),
    segments,
  };
}

async function transcribeChunk(
  chunk: AudioChunk,
  language: TranscribeLanguage,
  route: SttRoute,
  signal?: AbortSignal,
): Promise<ChunkResult> {
  checkSignal(signal);
  const wav = await encodeChunkToWav(chunk.buffer);
  checkSignal(signal);

  if (route === "local") {
    return transcribeChunkLocally(wav, language);
  }

  const dataUrl = await blobToDataUrl(wav);
  checkSignal(signal);

  const duration = Math.max(1, Math.round(chunk.endSeconds - chunk.startSeconds));
  const { data, error } = await callEdgeFunction("transcribe", {
    audio: dataUrl, language, duration,
  });
  if (error) throw new Error(error.message ?? "Chunk transcription failed");
  if (!(data as Record<string, unknown>)?.text) return { text: "" };
  return { text: String((data as Record<string, unknown>).text).trim() };
}

export async function transcribeLongForm({
  file,
  language,
  signal,
  onProgress,
  route,
  doneChunks,
  onChunkDone,
}: LongFormTranscribeArgs): Promise<LongFormTranscribeResult> {
  checkSignal(signal);

  const resolvedRoute = route ?? (await resolveSttRoute());
  checkSignal(signal);

  // For video files, show a distinct "extracting audio" phase before decoding.
  const isVideo = file instanceof File && isVideoFile(file);
  onProgress?.({ phase: isVideo ? "extracting" : "decoding" });

  const decoded = await decodeAudioFile(file);
  checkSignal(signal);

  if (decoded.duration > MAX_DURATION_SECONDS) {
    throw new Error(`Audio exceeds the ${MAX_DURATION_SECONDS / 60}-minute maximum`);
  }

  onProgress?.({ phase: "preparing" });
  const chunks = chunkAudioBuffer(decoded);
  checkSignal(signal);

  const parts: string[] = [];
  const spans: TranscriptSegment[] = [];
  const allSegments: TranscriptSegment[] = [];
  let everyChunkHadSegments = true;
  for (const chunk of chunks) {
    checkSignal(signal);
    // Pre-event: tells the UI which chunk is starting, with the transcript
    // accumulated from prior chunks.
    onProgress?.({
      phase: "transcribing",
      current: chunk.index + 1,
      total: chunks.length,
      partialTranscript: parts.join("\n\n"),
    });
    const kept = doneChunks?.[chunk.index];
    const { text, segments } = kept ?? (await transcribeChunk(chunk, language, resolvedRoute, signal));
    if (!kept) onChunkDone?.(chunk.index, { text, segments });
    if (text) {
      parts.push(text);
      spans.push({ start: chunk.startSeconds, end: chunk.endSeconds, text });
    }
    if (segments) {
      // Chunk-relative times become file-absolute, otherwise every chunk's
      // subtitles would start again from zero.
      for (const seg of segments) {
        allSegments.push({
          start: seg.start + chunk.startSeconds,
          end: seg.end + chunk.startSeconds,
          text: seg.text,
        });
      }
    } else {
      everyChunkHadSegments = false;
    }
    // Post-event: lets the UI persist the new partial transcript so a refresh
    // mid-transcription doesn't lose completed chunks (FR-3.7).
    onProgress?.({
      phase: "transcribing",
      current: chunk.index + 1,
      total: chunks.length,
      partialTranscript: parts.join("\n\n"),
    });
  }

  onProgress?.({
    phase: "finalizing",
    current: chunks.length,
    total: chunks.length,
    partialTranscript: parts.join("\n\n"),
  });

  return {
    text: parts.join("\n\n").trim(),
    durationSeconds: Math.round(decoded.duration),
    chunkCount: chunks.length,
    route: resolvedRoute,
    // Partial timestamps would produce subtitles that silently skip stretches of
    // audio, so they are offered only when every chunk supplied them.
    segments:
      everyChunkHadSegments && allSegments.length > 0 ? allSegments : undefined,
    chunkSpans: spans,
  };
}
