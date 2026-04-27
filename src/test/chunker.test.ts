import { describe, it, expect, beforeAll } from "vitest";
import { chunkAudioBuffer } from "@/lib/audio/chunker";

// jsdom does not implement the Web Audio API, so we provide minimal stand-ins
// that satisfy the chunker's contract: it only needs sampleRate / length /
// numberOfChannels / getChannelData / copyToChannel and an OfflineAudioContext
// constructor that can produce a sub-buffer.
class FakeAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private readonly channels: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number, fill?: (i: number) => number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => {
      const arr = new Float32Array(length);
      if (fill) for (let i = 0; i < length; i++) arr[i] = fill(i);
      return arr;
    });
  }

  get duration() {
    return this.length / this.sampleRate;
  }

  getChannelData(c: number): Float32Array {
    return this.channels[c];
  }

  copyToChannel(src: Float32Array, c: number, offset = 0): void {
    this.channels[c].set(src, offset);
  }
}

class FakeOfflineAudioContext {
  constructor(public numberOfChannels: number, public length: number, public sampleRate: number) {}
  createBuffer(numberOfChannels: number, length: number, sampleRate: number) {
    return new FakeAudioBuffer(numberOfChannels, length, sampleRate);
  }
}

beforeAll(() => {
  // The chunker reaches for window.OfflineAudioContext and window.AudioContext.
  const w = globalThis as unknown as { OfflineAudioContext: unknown; AudioContext: unknown };
  w.OfflineAudioContext = FakeOfflineAudioContext;
  w.AudioContext = class {}; // referenced by getAudioContextCtor; not constructed in chunkAudioBuffer
});

const SR = 16_000;

function makeBuffer(durationSeconds: number, fill: (i: number) => number = () => 0.5) {
  return new FakeAudioBuffer(1, Math.round(durationSeconds * SR), SR, fill) as unknown as AudioBuffer;
}

describe("chunkAudioBuffer", () => {
  it("returns a single chunk when audio is shorter than the target chunk size", () => {
    const buf = makeBuffer(60); // 1 minute
    const chunks = chunkAudioBuffer(buf, 300); // 5-min target
    expect(chunks).toHaveLength(1);
    expect(chunks[0].startSeconds).toBe(0);
    expect(chunks[0].endSeconds).toBeCloseTo(60, 5);
  });

  it("splits a long buffer into contiguous, non-overlapping chunks that cover the whole input", () => {
    const totalSeconds = 1500; // 25 minutes
    const buf = makeBuffer(totalSeconds);
    const chunks = chunkAudioBuffer(buf, 300);

    // ~5 chunks, allowing for ±10s silence-window nudging on internal boundaries.
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    expect(chunks.length).toBeLessThanOrEqual(6);

    // Coverage: first starts at 0, last ends at total duration.
    expect(chunks[0].startSeconds).toBe(0);
    expect(chunks[chunks.length - 1].endSeconds).toBeCloseTo(totalSeconds, 3);

    // Contiguity: chunk[i].endSeconds === chunk[i+1].startSeconds
    for (let i = 0; i < chunks.length - 1; i++) {
      expect(chunks[i].endSeconds).toBeCloseTo(chunks[i + 1].startSeconds, 5);
    }

    // Indexes are sequential.
    chunks.forEach((c, i) => expect(c.index).toBe(i));
  });

  it("nudges chunk boundaries toward a low-energy seam within the silence window", () => {
    // Loud everywhere except a quiet patch ~3s before the 300s boundary.
    const totalSeconds = 600;
    const quietCenterSec = 297;
    const quietWidthSec = 0.5;
    const buf = makeBuffer(totalSeconds, (i) => {
      const t = i / SR;
      const inQuiet = t > quietCenterSec - quietWidthSec / 2 && t < quietCenterSec + quietWidthSec / 2;
      return inQuiet ? 0 : 0.8;
    });

    const chunks = chunkAudioBuffer(buf, 300);
    // First boundary should land inside the quiet patch (within ±10s of 300s),
    // not exactly at 300s.
    const firstBoundary = chunks[0].endSeconds;
    expect(firstBoundary).toBeGreaterThan(quietCenterSec - quietWidthSec);
    expect(firstBoundary).toBeLessThan(quietCenterSec + quietWidthSec + 1);
    expect(firstBoundary).not.toBeCloseTo(300, 1);
  });

  it("preserves chunk durations close to the requested size", () => {
    const buf = makeBuffer(900); // 15 minutes
    const chunks = chunkAudioBuffer(buf, 300);
    // All but possibly the last chunk should be roughly 300s ±10s (silence window).
    // Internal chunks should be 300s ±10s (the silence-window nudge range).
    chunks.slice(0, -1).forEach((c) => {
      const dur = c.endSeconds - c.startSeconds;
      expect(dur).toBeGreaterThanOrEqual(290);
      expect(dur).toBeLessThanOrEqual(310);
    });
  });
});
