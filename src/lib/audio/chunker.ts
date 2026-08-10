// Audio chunking utilities for long-form transcription (SPEC-v2 §FR-3).
//
// Pipeline: File → AudioBuffer (decoded) → AudioBuffer[] (sliced) → WAV blob per chunk.
// We downmix to mono and resample to 16 kHz on encode so each chunk's base64 payload
// stays small enough for the existing stateless `transcribe` edge function.

import { MAX_FILE_SIZE_BYTES, WARN_FILE_SIZE_BYTES, getFormatLabel } from "./formatSupport";
import { logger } from "@/lib/logger";

const log = logger.child("chunker");

const TARGET_SAMPLE_RATE = 16_000;
const DEFAULT_CHUNK_SECONDS = 300; // ~5 minutes per FR-3.2
const SILENCE_SEARCH_SECONDS = 10; // search ±10s around target boundary for a quiet seam

type AudioCtxCtor = typeof AudioContext;
function getAudioContextCtor(): AudioCtxCtor {
  const w = window as unknown as { AudioContext?: AudioCtxCtor; webkitAudioContext?: AudioCtxCtor };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) throw new Error("Web Audio API is not available in this browser");
  return Ctor;
}

export async function decodeAudioFile(file: Blob): Promise<AudioBuffer> {
  // File-size safety checks — prevent browser tab crashes on huge video files.
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      "File is too large (max 1 GB). For large videos, extract the audio first.",
    );
  }
  if (file.size > WARN_FILE_SIZE_BYTES) {
    log.warn("large file, decoding may be slow", { megabytes: Number((file.size / 1024 / 1024).toFixed(0)) });
  }

  const Ctx = getAudioContextCtor();
  const ctx = new Ctx();
  try {
    const arrayBuf = await file.arrayBuffer();
    try {
      return await ctx.decodeAudioData(arrayBuf.slice(0));
    } catch (decodeErr) {
      // Produce a user-friendly error instead of the cryptic browser DOMException.
      const label = file instanceof File ? getFormatLabel(file) : "this file";
      throw new Error(
        `Your browser cannot decode ${label}. Try converting to MP3 or M4A, or use Chrome.`,
      );
    }
  } finally {
    void ctx.close();
  }
}

/**
 * Find a quiet seam near `targetSample` within ±`windowSamples` by scanning short
 * RMS windows. Falls back to `targetSample` if no clear minimum is found.
 */
function findSilenceBoundary(channel: Float32Array, targetSample: number, windowSamples: number): number {
  const probe = 1024;
  const start = Math.max(0, targetSample - windowSamples);
  const end = Math.min(channel.length, targetSample + windowSamples);
  if (end - start <= probe * 2) return targetSample;

  let bestIdx = targetSample;
  let bestRms = Infinity;
  for (let i = start; i + probe < end; i += probe) {
    let sum = 0;
    for (let j = 0; j < probe; j++) {
      const v = channel[i + j];
      sum += v * v;
    }
    const rms = Math.sqrt(sum / probe);
    if (rms < bestRms) {
      bestRms = rms;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export interface AudioChunk {
  index: number;
  startSeconds: number;
  endSeconds: number;
  buffer: AudioBuffer;
}

/**
 * Slice an AudioBuffer into chunks of approximately `chunkSeconds` each.
 * Boundaries are nudged toward local silence within ±SILENCE_SEARCH_SECONDS when possible.
 */
export function chunkAudioBuffer(buffer: AudioBuffer, chunkSeconds: number = DEFAULT_CHUNK_SECONDS): AudioChunk[] {
  const sampleRate = buffer.sampleRate;
  const totalSamples = buffer.length;
  const chunkSamples = Math.round(chunkSeconds * sampleRate);
  const silenceWin = Math.round(SILENCE_SEARCH_SECONDS * sampleRate);

  // Use channel 0 for boundary detection.
  const ch0 = buffer.getChannelData(0);
  const Ctor = getAudioContextCtor();

  const chunks: AudioChunk[] = [];
  let cursor = 0;
  let index = 0;

  while (cursor < totalSamples) {
    let end = Math.min(totalSamples, cursor + chunkSamples);
    if (end < totalSamples) {
      end = findSilenceBoundary(ch0, end, silenceWin);
    }
    const length = end - cursor;
    if (length <= 0) break;

    // Build a sub-buffer using a transient OfflineAudioContext (cheap).
    const offline = new (window as unknown as { OfflineAudioContext: typeof OfflineAudioContext }).OfflineAudioContext(
      buffer.numberOfChannels,
      length,
      sampleRate,
    );
    const sub = offline.createBuffer(buffer.numberOfChannels, length, sampleRate);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      sub.copyToChannel(buffer.getChannelData(c).subarray(cursor, end), c, 0);
    }

    chunks.push({
      index,
      startSeconds: cursor / sampleRate,
      endSeconds: end / sampleRate,
      buffer: sub,
    });

    cursor = end;
    index += 1;
    void Ctor; // keep ref to avoid TS unused-var
  }

  return chunks;
}

/**
 * Resample to TARGET_SAMPLE_RATE and downmix to mono via OfflineAudioContext.
 */
async function toMono16k(buffer: AudioBuffer): Promise<AudioBuffer> {
  const targetLength = Math.ceil((buffer.duration * TARGET_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE);
  const src = offline.createBufferSource();
  src.buffer = buffer;

  // Downmix: connect via a ChannelMergerNode trick, or just use a GainNode and
  // rely on Web Audio's automatic downmix-to-mono when destination is mono.
  src.connect(offline.destination);
  src.start();
  return await offline.startRendering();
}

/** Encode an AudioBuffer (mono) as a 16-bit PCM WAV blob. */
function encodeWavMono(buffer: AudioBuffer): Blob {
  const numFrames = buffer.length;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;
  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);            // PCM chunk size
  view.setUint16(20, 1, true);             // PCM format
  view.setUint16(22, 1, true);             // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);            // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  const channel = buffer.getChannelData(0);
  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    const s = Math.max(-1, Math.min(1, channel[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([ab], { type: "audio/wav" });
}

/** Encode an AudioBuffer chunk to a 16 kHz mono WAV blob ready for upload. */
export async function encodeChunkToWav(buffer: AudioBuffer): Promise<Blob> {
  const mono16k = await toMono16k(buffer);
  return encodeWavMono(mono16k);
}

/** Read a Blob as a base64 data URL (data:audio/wav;base64,...). */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.readAsDataURL(blob);
  });
}
