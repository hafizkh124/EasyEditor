import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TranscriptSegment } from "@/core/voice/types";

vi.mock("@/lib/audio/chunker", () => ({
  decodeAudioFile: vi.fn(),
  chunkAudioBuffer: vi.fn(),
  // jsdom's Blob has no arrayBuffer() (Chromium, where this actually runs,
  // does), so the mock supplies one.
  encodeChunkToWav: vi.fn(async () => {
    const blob = new Blob(["wav"], { type: "audio/wav" });
    return Object.assign(blob, { arrayBuffer: async () => new ArrayBuffer(8) });
  }),
  blobToDataUrl: vi.fn(async () => "data:audio/wav;base64,AAA="),
}));

const invokeMock = vi.fn();
vi.mock("@/core/ai/aiAdapter", () => ({
  callEdgeFunction: (...args: unknown[]) => invokeMock(...args),
}));

const isDesktopMock = vi.fn(() => true);
vi.mock("@/utils/environment", () => ({
  isDesktop: () => isDesktopMock(),
}));

import {
  transcribeLongForm,
  resolveSttRoute,
} from "@/lib/audio/transcribeLongForm";
import { decodeAudioFile, chunkAudioBuffer } from "@/lib/audio/chunker";
import { setPreferredSttEngine } from "@/core/voice/registry";

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

const transcribeIpc = vi.fn<(req: unknown) => Promise<TranscriptSegment[]>>();
const getModelsIpc = vi.fn();

function installElectronApi() {
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    voice: {
      transcribe: (req: unknown) => transcribeIpc(req),
      getModels: () => getModelsIpc(),
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  invokeMock.mockReset();
  decodeMock.mockReset();
  chunkMock.mockReset();
  transcribeIpc.mockReset();
  getModelsIpc.mockReset();
  isDesktopMock.mockReturnValue(true);
  getModelsIpc.mockResolvedValue([
    { id: "whisper-small", engine: "whisper", downloaded: true },
  ]);
  installElectronApi();
});

describe("resolveSttRoute (SPEC-M5 FR-6.2)", () => {
  it("stays on cloud on the web even when the engine is set to whisper", async () => {
    isDesktopMock.mockReturnValue(false);
    setPreferredSttEngine("whisper");
    expect(await resolveSttRoute()).toBe("cloud");
  });

  it("defaults to cloud, so existing behaviour is unchanged", async () => {
    expect(await resolveSttRoute()).toBe("cloud");
  });

  it("goes local when whisper is chosen and a model is downloaded", async () => {
    setPreferredSttEngine("whisper");
    expect(await resolveSttRoute()).toBe("local");
  });

  it("stays on cloud when whisper is chosen but no model is downloaded", async () => {
    setPreferredSttEngine("whisper");
    getModelsIpc.mockResolvedValue([
      { id: "whisper-small", engine: "whisper", downloaded: false },
      { id: "piper-ur_PK-male-medium", engine: "piper", downloaded: true },
    ]);
    expect(await resolveSttRoute()).toBe("cloud");
  });

  it("stays on cloud when the model query fails", async () => {
    setPreferredSttEngine("whisper");
    getModelsIpc.mockRejectedValue(new Error("ipc down"));
    expect(await resolveSttRoute()).toBe("cloud");
  });
});

describe("local transcription route", () => {
  it("uses the local engine and never calls the edge function", async () => {
    decodeMock.mockResolvedValue({ duration: 300 });
    chunkMock.mockReturnValue(fakeChunks(1));
    transcribeIpc.mockResolvedValue([{ start: 0, end: 2, text: "سلام" }]);

    const result = await transcribeLongForm({
      file: new Blob(["audio"]),
      language: "ur-PK",
      route: "local",
    });

    expect(result.route).toBe("local");
    expect(result.text).toBe("سلام");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("makes segment times absolute across chunks (FR-6.3)", async () => {
    decodeMock.mockResolvedValue({ duration: 900 });
    chunkMock.mockReturnValue(fakeChunks(3));
    // Every chunk reports times from zero — the orchestrator must offset them.
    transcribeIpc.mockResolvedValue([
      { start: 0, end: 10, text: "one" },
      { start: 10, end: 20, text: "two" },
    ]);

    const result = await transcribeLongForm({
      file: new Blob(["audio"]),
      language: "ur-PK",
      route: "local",
    });

    expect(result.segments).toBeDefined();
    expect(result.segments!.map((s) => [s.start, s.end])).toEqual([
      [0, 10], [10, 20],
      [300, 310], [310, 320],
      [600, 610], [610, 620],
    ]);
    // Timestamps must never go backwards, or subtitles jump.
    const starts = result.segments!.map((s) => s.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it("offers no segments on the cloud route, so subtitles stay unavailable", async () => {
    decodeMock.mockResolvedValue({ duration: 300 });
    chunkMock.mockReturnValue(fakeChunks(1));
    invokeMock.mockResolvedValue({ data: { text: "cloud text" }, error: null });

    const result = await transcribeLongForm({
      file: new Blob(["audio"]),
      language: "ur-PK",
      route: "cloud",
    });

    expect(result.route).toBe("cloud");
    expect(result.segments).toBeUndefined();
    expect(transcribeIpc).not.toHaveBeenCalled();
  });

  it("keeps subtitles available when a chunk is silent", async () => {
    decodeMock.mockResolvedValue({ duration: 600 });
    chunkMock.mockReturnValue(fakeChunks(2));
    // An empty array means Whisper heard no speech in that chunk — silence, not
    // an engine without timestamps. Dropping every subtitle over it would be wrong.
    transcribeIpc
      .mockResolvedValueOnce([{ start: 0, end: 5, text: "has times" }])
      .mockResolvedValueOnce([]);

    const result = await transcribeLongForm({
      file: new Blob(["audio"]),
      language: "ur-PK",
      route: "local",
    });

    expect(result.segments).toEqual([{ start: 0, end: 5, text: "has times" }]);
    expect(result.text).toContain("has times");
  });

  it("passes the language straight through, including 'auto' (FR-6.10)", async () => {
    decodeMock.mockResolvedValue({ duration: 300 });
    chunkMock.mockReturnValue(fakeChunks(1));
    transcribeIpc.mockResolvedValue([{ start: 0, end: 1, text: "x" }]);

    await transcribeLongForm({
      file: new Blob(["audio"]),
      language: "auto",
      route: "local",
    });

    expect(transcribeIpc).toHaveBeenCalledWith(
      expect.objectContaining({ lang: "auto", engineId: "whisper" }),
    );
  });
});
