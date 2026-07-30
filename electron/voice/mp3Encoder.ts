// PCM WAV → MP3, for the FR-6.9 audiobook export.
//
// WHY a JavaScript encoder: FR-6.9 asks for .mp3, but Piper emits WAV and
// NFR-14 keeps binaries out of the installer. `@breezystack/lamejs` is a pure-JS
// LAME port (LGPL-3.0), so nothing per-platform has to be shipped or built. It
// is slower than native LAME, which is acceptable for an offline export that
// already spends most of its time in synthesis.

import { Mp3Encoder } from '@breezystack/lamejs';

/** Samples per MP3 frame — lamejs expects buffers in these units. */
const SAMPLES_PER_FRAME = 1152;

export interface WavFormat {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** Offset of the first PCM byte. */
  dataOffset: number;
  /** Length of the PCM payload in bytes. */
  dataLength: number;
}

/**
 * Reads the format out of a RIFF/WAVE buffer.
 *
 * The chunks are walked rather than assuming the canonical 44-byte layout: some
 * writers insert LIST/fact chunks, and slicing at a fixed 44 would then feed
 * metadata to the encoder as if it were audio.
 */
export function readWavFormat(wav: Buffer): WavFormat {
  if (wav.length < 12 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('MP3 انکوڈنگ: ان پٹ WAV فائل نہیں ہے۔');
  }

  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataLength = 0;

  let cursor = 12;
  while (cursor + 8 <= wav.length) {
    const chunkId = wav.toString('ascii', cursor, cursor + 4);
    const chunkSize = wav.readUInt32LE(cursor + 4);
    const body = cursor + 8;

    if (chunkId === 'fmt ' && body + 16 <= wav.length) {
      channels = wav.readUInt16LE(body + 2);
      sampleRate = wav.readUInt32LE(body + 4);
      bitsPerSample = wav.readUInt16LE(body + 14);
    } else if (chunkId === 'data') {
      dataOffset = body;
      // A truncated file can claim more data than it holds; trust the smaller.
      dataLength = Math.min(chunkSize, wav.length - body);
    }

    // Chunks are word-aligned: an odd size is followed by a pad byte.
    cursor = body + chunkSize + (chunkSize % 2);
  }

  if (!sampleRate || !channels || !bitsPerSample) {
    throw new Error('MP3 انکوڈنگ: WAV کا fmt حصہ نہیں ملا۔');
  }
  if (dataOffset < 0) {
    throw new Error('MP3 انکوڈنگ: WAV کا data حصہ نہیں ملا۔');
  }
  if (bitsPerSample !== 16) {
    throw new Error(`MP3 انکوڈنگ: صرف 16-bit PCM سپورٹ ہے (ملا ${bitsPerSample}-bit)۔`);
  }
  if (channels !== 1 && channels !== 2) {
    throw new Error(`MP3 انکوڈنگ: صرف mono یا stereo سپورٹ ہے (ملا ${channels} چینل)۔`);
  }

  return { sampleRate, channels, bitsPerSample, dataOffset, dataLength };
}

export interface Mp3EncodeOptions {
  /** Constant bitrate in kbps. 64 is ample for a mono speech audiobook. */
  bitrateKbps?: number;
  /** Reports progress in [0, 1] as the PCM is consumed. */
  onProgress?: (fraction: number) => void;
  /** Checked between blocks; returning true aborts with an error. */
  isCancelled?: () => boolean;
}

export class Mp3EncodeCancelledError extends Error {
  constructor() {
    super('MP3 انکوڈنگ منسوخ کر دی گئی۔');
    this.name = 'Mp3EncodeCancelledError';
  }
}

/**
 * Encodes a 16-bit PCM WAV buffer to MP3.
 *
 * Progress and cancellation are checked per block rather than at the end,
 * because a book-length encode runs for minutes and would otherwise be a frozen
 * UI with no way out.
 */
export function wavToMp3(wav: Buffer, options: Mp3EncodeOptions = {}): Buffer {
  const { bitrateKbps = 64, onProgress, isCancelled } = options;
  const format = readWavFormat(wav);

  if (format.dataLength === 0) {
    throw new Error('MP3 انکوڈنگ: WAV میں کوئی آڈیو ڈیٹا نہیں۔');
  }

  const encoder = new Mp3Encoder(format.channels, format.sampleRate, bitrateKbps);
  const output: Buffer[] = [];

  // A Buffer's memory is not necessarily 2-byte aligned, which Int16Array
  // requires, so the PCM is copied into an aligned view before sampling.
  const pcmBytes = Buffer.from(
    wav.subarray(format.dataOffset, format.dataOffset + format.dataLength),
  );
  const totalSamples = Math.floor(pcmBytes.length / 2);
  const samples = new Int16Array(pcmBytes.buffer, pcmBytes.byteOffset, totalSamples);

  const push = (chunk: Int8Array | Uint8Array) => {
    if (chunk.length > 0) {
      output.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.length));
    }
  };

  const frameSamples = SAMPLES_PER_FRAME * format.channels;
  for (let offset = 0; offset < totalSamples; offset += frameSamples) {
    if (isCancelled?.()) throw new Mp3EncodeCancelledError();

    const block = samples.subarray(offset, Math.min(offset + frameSamples, totalSamples));
    if (format.channels === 1) {
      push(encoder.encodeBuffer(block));
    } else {
      // lamejs takes separate channel buffers; interleaved input must be split.
      const frames = Math.floor(block.length / 2);
      const left = new Int16Array(frames);
      const right = new Int16Array(frames);
      for (let i = 0; i < frames; i++) {
        left[i] = block[i * 2];
        right[i] = block[i * 2 + 1];
      }
      push(encoder.encodeBuffer(left, right));
    }

    onProgress?.(Math.min(1, (offset + frameSamples) / totalSamples));
  }

  push(encoder.flush());
  onProgress?.(1);

  return Buffer.concat(output);
}

/** Duration of a 16-bit PCM WAV, in milliseconds. */
export function wavDurationMs(wav: Buffer): number {
  const { sampleRate, channels, dataLength } = readWavFormat(wav);
  const bytesPerSecond = sampleRate * channels * 2;
  return bytesPerSecond === 0 ? 0 : Math.round((dataLength / bytesPerSecond) * 1000);
}
