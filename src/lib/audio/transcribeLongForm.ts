// Long-form transcription orchestrator (SPEC-v2 §FR-3).
//
// Decodes the audio file, slices it into ~5-minute chunks, sends each chunk to
// the existing stateless `transcribe` edge function, and reassembles the text in
// order. Emits phased progress events and supports cancellation via AbortSignal.

import { supabase } from "@/integrations/supabase/client";
import { decodeAudioFile, chunkAudioBuffer, encodeChunkToWav, blobToDataUrl, type AudioChunk } from "./chunker";

export const MAX_DURATION_SECONDS = 60 * 60; // FR-3.1: 60-minute hard cap
export const CHUNK_THRESHOLD_SECONDS = 300;  // files longer than this are auto-chunked

export type ProgressPhase = "decoding" | "preparing" | "transcribing" | "finalizing";

export interface ProgressEvent {
  phase: ProgressPhase;
  /** 1-based index of the current chunk being processed (transcribing phase only). */
  current?: number;
  /** Total chunk count (transcribing phase only). */
  total?: number;
  /** Cumulative transcript so far (incrementally updated as chunks complete). */
  partialTranscript?: string;
}

export type TranscribeLanguage = "en-US" | "ur-PK" | "auto";

export interface LongFormTranscribeArgs {
  file: Blob;
  language: TranscribeLanguage;
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
}

export interface LongFormTranscribeResult {
  text: string;
  durationSeconds: number;
  chunkCount: number;
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

async function transcribeChunk(
  chunk: AudioChunk,
  language: TranscribeLanguage,
  signal?: AbortSignal,
): Promise<string> {
  checkSignal(signal);
  const wav = await encodeChunkToWav(chunk.buffer);
  checkSignal(signal);
  const dataUrl = await blobToDataUrl(wav);
  checkSignal(signal);

  const duration = Math.max(1, Math.round(chunk.endSeconds - chunk.startSeconds));
  const { data, error } = await supabase.functions.invoke("transcribe", {
    body: { audio: dataUrl, language, duration },
  });
  if (error) throw new Error(error.message ?? "Chunk transcription failed");
  if (!data?.text) return "";
  return String(data.text).trim();
}

export async function transcribeLongForm({
  file,
  language,
  signal,
  onProgress,
}: LongFormTranscribeArgs): Promise<LongFormTranscribeResult> {
  checkSignal(signal);
  onProgress?.({ phase: "decoding" });

  const decoded = await decodeAudioFile(file);
  checkSignal(signal);

  if (decoded.duration > MAX_DURATION_SECONDS) {
    throw new Error(`Audio exceeds the ${MAX_DURATION_SECONDS / 60}-minute maximum`);
  }

  onProgress?.({ phase: "preparing" });
  const chunks = chunkAudioBuffer(decoded);
  checkSignal(signal);

  const parts: string[] = [];
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
    const text = await transcribeChunk(chunk, language, signal);
    if (text) parts.push(text);
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
  };
}
