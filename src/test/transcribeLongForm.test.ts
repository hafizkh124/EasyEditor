// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the chunker so we can fabricate chunk arrays without Web Audio.
vi.mock("@/lib/audio/chunker", () => ({
  decodeAudioFile: vi.fn(),
  chunkAudioBuffer: vi.fn(),
  encodeChunkToWav: vi.fn(async () => new Blob(["wav"], { type: "audio/wav" })),
  blobToDataUrl: vi.fn(async () => "data:audio/wav;base64,AAA="),
}));

// Mock the AI adapter's edge-function invoke.
const invokeMock = vi.fn();
vi.mock("@/core/ai/aiAdapter", () => ({
  callEdgeFunction: (...args: unknown[]) => invokeMock(...args),
}));

import { transcribeLongForm, TranscribeCancelledError, type ProgressEvent } from "@/lib/audio/transcribeLongForm";
import { decodeAudioFile, chunkAudioBuffer } from "@/lib/audio/chunker";

const decodeMock = decodeAudioFile as unknown as ReturnType<typeof vi.fn>;
const chunkMock = chunkAudioBuffer as unknown as ReturnType<typeof vi.fn>;

function fakeChunks(count: number, secondsEach = 300) {
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    startSeconds: i * secondsEach,
    endSeconds: (i + 1) * secondsEach,
    buffer: {} as AudioBuffer,
  }));
}

beforeEach(() => {
  invokeMock.mockReset();
  decodeMock.mockReset();
  chunkMock.mockReset();
});

describe("transcribeLongForm", () => {
  it("concatenates per-chunk text and reports final duration / chunk count", async () => {
    decodeMock.mockResolvedValue({ duration: 600 });
    chunkMock.mockReturnValue(fakeChunks(2));
    invokeMock
      .mockResolvedValueOnce({ data: { text: "first part" }, error: null })
      .mockResolvedValueOnce({ data: { text: "second part" }, error: null });

    const result = await transcribeLongForm({
      file: new Blob(["audio"]),
      language: "en-US",
    });

    expect(result.text).toBe("first part\n\nsecond part");
    expect(result.chunkCount).toBe(2);
    expect(result.durationSeconds).toBe(600);
  });

  it("emits a post-chunk progress event so the page can persist partial transcripts (FR-3.7)", async () => {
    decodeMock.mockResolvedValue({ duration: 900 });
    chunkMock.mockReturnValue(fakeChunks(3));
    invokeMock
      .mockResolvedValueOnce({ data: { text: "A" }, error: null })
      .mockResolvedValueOnce({ data: { text: "B" }, error: null })
      .mockResolvedValueOnce({ data: { text: "C" }, error: null });

    const events: ProgressEvent[] = [];
    await transcribeLongForm({
      file: new Blob(["audio"]),
      language: "en-US",
      onProgress: (ev) => events.push(ev),
    });

    const partials = events
      .filter((e) => e.phase === "transcribing" && typeof e.partialTranscript === "string")
      .map((e) => e.partialTranscript);

    // Each chunk fires a pre-event ("" / "A" / "A\n\nB") then a post-event
    // ("A" / "A\n\nB" / "A\n\nB\n\nC"). The post-events are what the page
    // uses to persist incremental progress.
    expect(partials).toContain("A");
    expect(partials).toContain("A\n\nB");
    expect(partials).toContain("A\n\nB\n\nC");

    // Partial transcript is monotonically non-decreasing.
    let prevLen = -1;
    for (const p of partials) {
      expect((p ?? "").length).toBeGreaterThanOrEqual(prevLen);
      prevLen = (p ?? "").length;
    }
  });

  it("rejects audio over the 120-minute hard cap before any network call", async () => {
    decodeMock.mockResolvedValue({ duration: 120 * 60 + 1 });
    chunkMock.mockReturnValue([]);

    await expect(
      transcribeLongForm({ file: new Blob(["audio"]), language: "en-US" }),
    ).rejects.toThrow(/120-minute/);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("aborts cleanly when the AbortSignal fires mid-run", async () => {
    decodeMock.mockResolvedValue({ duration: 900 });
    chunkMock.mockReturnValue(fakeChunks(3));
    const controller = new AbortController();
    invokeMock.mockImplementation(async () => {
      // Trigger cancellation after the first chunk's transcribe call.
      controller.abort();
      return { data: { text: "first" }, error: null };
    });

    await expect(
      transcribeLongForm({
        file: new Blob(["audio"]),
        language: "en-US",
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(TranscribeCancelledError);

    // Only the first chunk should have been invoked before cancellation took effect.
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("propagates a chunk transcription error without persisting partial state", async () => {
    decodeMock.mockResolvedValue({ duration: 600 });
    chunkMock.mockReturnValue(fakeChunks(2));
    invokeMock
      .mockResolvedValueOnce({ data: { text: "first" }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "AI gateway 500" } });

    await expect(
      transcribeLongForm({ file: new Blob(["audio"]), language: "en-US" }),
    ).rejects.toThrow("AI gateway 500");
  });
});
