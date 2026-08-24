// @vitest-environment node
// electron/ipc/voiceHandlers.ts — switch-free, but three properties here are
// worth the same rigor as a security boundary:
//   1. FR-6.6's consent gate: edge-tts (online) must never be reached without
//      explicit onlineConsent === true, and an online failure must fall back
//      to local Piper rather than leaving the user with silence.
//   2. VOICE_SAVE_CLONE_SAMPLE's path-traversal defense — a renderer-supplied
//      filename written to disk, with two independent guards
//      (path.basename() + a resolved-path prefix check).
//   3. Audiobook export cancellation is per-window (keyed by
//      event.sender.id) and stored in module-level state shared across every
//      call to registerVoiceHandlers() in the same process — exactly the kind
//      of state that is easy to leak between windows or between exports.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElectronMock } from "./helpers/electronMock";

const electron = createElectronMock();
const userDataDir = mkdtempSync(join(tmpdir(), "easyeditor-voice-userdata-"));
const osTempDir = mkdtempSync(join(tmpdir(), "easyeditor-voice-ostemp-"));
electron.app.getPath = vi.fn((key: string) => (key === "temp" ? osTempDir : userDataDir));
// Overridden per-test via `beforeEach` below and per-case
// `mockResolvedValueOnce` calls — the shared default in electronMock.ts
// resolves `canceled: true`, which is wrong for most of this file's tests.
vi.mock("electron", () => electron);

const voiceMocks = {
  synthesizeWithEdgeTts: vi.fn(async () => Buffer.from("edge-audio")),
  synthesizeLocalTts: vi.fn(async () => Buffer.from("piper-audio")),
  transcribeWithWhisper: vi.fn(
    async (_audioPath: string, _lang: string, _modelPath?: string) => [
      { start: 0, end: 1, text: "transcribed text" },
    ],
  ),
  listModels: vi.fn(async () => [{ id: "whisper-small", installed: true }]),
  // Default does NOT call onProgress — most tests here don't provide a real
  // sender (electron.invoke() fixes it to `{ sender: null }`), so a default
  // that always fires the callback would throw for every one of them except
  // the test written specifically to exercise progress forwarding.
  downloadModel: vi.fn(async (_id: string, _onProgress?: (p: unknown) => void) => ({
    id: "whisper-small",
    installed: true,
  })),
  deleteModel: vi.fn(async () => undefined),
  getModelPath: vi.fn(() => "/fake/models/whisper-small.bin"),
};
vi.mock("../../electron/voice/edgeTts.ts", () => ({
  synthesizeWithEdgeTts: voiceMocks.synthesizeWithEdgeTts,
}));
vi.mock("../../electron/voice/localTts.ts", () => ({
  synthesizeLocalTts: voiceMocks.synthesizeLocalTts,
}));
vi.mock("../../electron/voice/whisper.ts", () => ({
  transcribeWithWhisper: voiceMocks.transcribeWithWhisper,
}));
vi.mock("../../electron/voice/modelManager.ts", () => ({
  listModels: voiceMocks.listModels,
  downloadModel: voiceMocks.downloadModel,
  deleteModel: voiceMocks.deleteModel,
  getModelPath: voiceMocks.getModelPath,
}));

const sidecarMocks = {
  checkSidecarStatus: vi.fn(async () => ({ installed: true })),
  installSidecarEnv: vi.fn(async () => ({ success: true, message: "installed" })),
};
vi.mock("../../electron/voice/pythonSidecar.ts", () => sidecarMocks);

// Declared before `audiobookMocks` is USED (not before it's written — class
// declarations are not hoisted), which is fine: the mock's inner function
// only runs later, once a test invokes the handler, by which point this
// class is defined. Referenced directly rather than through an indirection
// variable — there is only ever one class here, so a `let` alias just for
// declaration-order reasons was solving a problem that doesn't exist.
class AudiobookCancelledErrorClass extends Error {}

const audiobookMocks = {
  exportAudiobook: vi.fn(async (opts: { isCancelled: () => boolean; onProgress: (p: unknown) => void }) => {
    opts.onProgress({ phase: "synthesizing", percent: 50 });
    if (opts.isCancelled()) throw new AudiobookCancelledErrorClass("cancelled mid-export");
    return { mp3: Buffer.from("mp3-bytes"), durationMs: 1000, chapters: [{}] };
  }),
};
vi.mock("../../electron/voice/audiobook.ts", () => ({
  exportAudiobook: audiobookMocks.exportAudiobook,
  AudiobookCancelledError: AudiobookCancelledErrorClass,
}));

let mod: typeof import("../../electron/ipc/voiceHandlers.ts");

beforeAll(async () => {
  mod = await import("../../electron/ipc/voiceHandlers.ts");
  mod.registerVoiceHandlers();
});

beforeEach(() => {
  vi.clearAllMocks();
  electron.dialog.showSaveDialog.mockResolvedValue({
    canceled: false,
    filePath: join(userDataDir, "book.mp3"),
  });
});

const invoke = (channel: string, ...args: unknown[]) => electron.invoke(channel, ...args);
const invokeWithSender = (channel: string, sender: unknown, ...args: unknown[]) => {
  const fn = electron.ipcMain.handlers.get(channel);
  if (!fn) throw new Error(`no handler for ${channel}`);
  return fn({ sender }, ...args);
};

describe("registration", () => {
  it("registers every documented voice channel", () => {
    expect([...electron.ipcMain.handlers.keys()].sort()).toEqual(
      [
        "voice:synthesize",
        "voice:transcribe",
        "voice:get-models",
        "voice:download-model",
        "voice:delete-model",
        "voice:sidecar-status",
        "voice:sidecar-install",
        "voice:save-clone-sample",
        "voice:cancel-audiobook",
        "voice:export-audiobook",
      ].sort(),
    );
  });
});

describe("voice:synthesize — the FR-6.6 consent gate", () => {
  it("refuses edge-tts without explicit consent, never reaching the network call", async () => {
    await expect(
      invoke("voice:synthesize", { text: "hi", lang: "en", engineId: "edge-tts", onlineConsent: false }),
    ).rejects.toThrow(/رضامندی/);
    expect(voiceMocks.synthesizeWithEdgeTts).not.toHaveBeenCalled();
  });

  it("refuses edge-tts when consent is simply omitted", async () => {
    await expect(
      invoke("voice:synthesize", { text: "hi", lang: "en", engineId: "edge-tts" }),
    ).rejects.toThrow();
  });

  it("synthesizes online once consent is explicit", async () => {
    const result = await invoke("voice:synthesize", {
      text: "hi", lang: "en", engineId: "edge-tts", onlineConsent: true,
    });
    expect(result).toMatchObject({ engineUsed: "edge-tts", mimeType: "audio/mpeg" });
  });

  it("falls back to local Piper on an online failure, and says why", async () => {
    voiceMocks.synthesizeWithEdgeTts.mockRejectedValueOnce(new Error("network unreachable"));
    const result = await invoke("voice:synthesize", {
      text: "hi", lang: "en", engineId: "edge-tts", onlineConsent: true,
    });
    expect(result).toMatchObject({
      engineUsed: "piper",
      fallbackFrom: "edge-tts",
      fallbackReason: "network unreachable",
    });
  });

  it("reports both failures when the fallback also fails — never silent", async () => {
    voiceMocks.synthesizeWithEdgeTts.mockRejectedValueOnce(new Error("network unreachable"));
    voiceMocks.synthesizeLocalTts.mockRejectedValueOnce(new Error("no piper model installed"));
    await expect(
      invoke("voice:synthesize", { text: "hi", lang: "en", engineId: "edge-tts", onlineConsent: true }),
    ).rejects.toThrow(/network unreachable.*no piper model installed/s);
  });

  it("goes straight to Piper for a non-edge-tts engine, no consent needed", async () => {
    const result = await invoke("voice:synthesize", { text: "hi", lang: "en", engineId: "piper" });
    expect(result).toMatchObject({ engineUsed: "piper" });
    expect(voiceMocks.synthesizeWithEdgeTts).not.toHaveBeenCalled();
  });
});

describe("voice:transcribe", () => {
  it("throws when neither audio bytes nor a path are given", async () => {
    await expect(invoke("voice:transcribe", { lang: "en" })).rejects.toThrow();
  });

  it("transcribes a given path directly, writing no temp file", async () => {
    await invoke("voice:transcribe", { audioPath: "/real/file.wav", lang: "en" });
    expect(voiceMocks.transcribeWithWhisper).toHaveBeenCalledWith("/real/file.wav", "en", "/fake/models/whisper-small.bin");
  });

  it("writes in-memory audio bytes to a temp file and cleans it up afterward", async () => {
    const audio = new TextEncoder().encode("fake-wav-bytes").buffer;
    await invoke("voice:transcribe", { audio, lang: "ur" });

    const [calledPath] = voiceMocks.transcribeWithWhisper.mock.calls[0];
    expect(calledPath).toContain("easyeditor-stt-");
    expect(existsSync(calledPath)).toBe(false); // cleaned up after the call
  });

  it("cleans up the temp file even when transcription itself throws", async () => {
    voiceMocks.transcribeWithWhisper.mockRejectedValueOnce(new Error("model missing"));
    const audio = new TextEncoder().encode("bytes").buffer;
    await expect(invoke("voice:transcribe", { audio, lang: "en" })).rejects.toThrow("model missing");
    // No leftover easyeditor-stt-* directories in the fake temp root.
    const fs = await import("node:fs");
    const leftovers = fs.readdirSync(osTempDir).filter((f) => f.startsWith("easyeditor-stt-"));
    expect(leftovers).toEqual([]);
  });

  it("defaults to whisper-small when no engineId is given", async () => {
    await invoke("voice:transcribe", { audioPath: "/x.wav" });
    expect(voiceMocks.getModelPath).toHaveBeenCalledWith("whisper-small");
  });
});

describe("model management — thin forwarding", () => {
  it("lists models", async () => {
    await expect(invoke("voice:get-models")).resolves.toEqual([{ id: "whisper-small", installed: true }]);
  });

  it("downloads a model given as a bare string and streams progress to the window", async () => {
    voiceMocks.downloadModel.mockImplementationOnce(async (_id, onProgress?: (p: unknown) => void) => {
      onProgress?.({ percent: 100 });
      return { id: "whisper-small", installed: true };
    });
    const send = vi.fn();
    await invokeWithSender("voice:download-model", { send }, "whisper-small");
    expect(voiceMocks.downloadModel).toHaveBeenCalledWith("whisper-small", expect.any(Function));
    expect(send).toHaveBeenCalledWith("voice:download-model-progress", { percent: 100 });
  });

  it("downloads a model given as { modelId } too", async () => {
    await invoke("voice:download-model", { modelId: "whisper-medium" });
    expect(voiceMocks.downloadModel).toHaveBeenCalledWith("whisper-medium", expect.any(Function));
  });

  it("deletes a model", async () => {
    await invoke("voice:delete-model", "whisper-small");
    expect(voiceMocks.deleteModel).toHaveBeenCalledWith("whisper-small");
  });
});

describe("sidecar status/install — dynamic imports", () => {
  it("checks sidecar status", async () => {
    await expect(invoke("voice:sidecar-status")).resolves.toEqual({ installed: true });
  });

  it("installs the sidecar environment", async () => {
    await expect(invoke("voice:sidecar-install")).resolves.toEqual({ success: true, message: "installed" });
  });
});

describe("voice:save-clone-sample — path-traversal defense", () => {
  // Mutation-testing note: the handler has a SECOND guard after building
  // targetPath — `if (!targetPath.startsWith(clonesDir + path.sep)) throw`.
  // No test below can catch that specific line being deleted: it is genuine
  // defense-in-depth, and given the source's own guarantees (an allowlisted
  // character set with no `/` or `\`, plus rejecting anything that still
  // starts with `.` after basename()), no input reaches this file that
  // could make targetPath escape clonesDir in the first place — there is no
  // known filename that passes guard 1 and needs guard 2. That is the
  // correct state for defense-in-depth to be in (it protects against a
  // *future* weakening of guard 1, not today's inputs), but it does mean
  // this second check is untestable in isolation without first weakening
  // guard 1, which would defeat the point of testing it. Recorded here so a
  // "why didn't this mutation get caught" investigation doesn't have to
  // rediscover this.

  afterEach(() => {
    rmSync(join(userDataDir, "voice-clones"), { recursive: true, force: true });
  });

  it("writes a normal filename into the voice-clones directory", async () => {
    const buffer = new TextEncoder().encode("sample-bytes").buffer;
    const result = await invoke("voice:save-clone-sample", buffer, "my-sample.wav");
    expect(result).toBe(join(userDataDir, "voice-clones", "my-sample.wav"));
    expect(readFileSync(result as string, "utf8")).toBe("sample-bytes");
  });

  it("strips a path-traversal attempt down to just the basename", async () => {
    const buffer = new TextEncoder().encode("x").buffer;
    const result = await invoke("voice:save-clone-sample", buffer, "../../../evil.wav");
    expect(result).toBe(join(userDataDir, "voice-clones", "evil.wav"));
    expect(result).not.toContain("..");
  });

  it("strips characters outside the safe set to underscores", async () => {
    const buffer = new TextEncoder().encode("x").buffer;
    const result = (await invoke("voice:save-clone-sample", buffer, "sam;ple<>.wav")) as string;
    expect(result.split(/[/\\]/).pop()).toBe("sam_ple__.wav");
  });

  it("rejects a filename that sanitizes to nothing", async () => {
    const buffer = new TextEncoder().encode("x").buffer;
    await expect(invoke("voice:save-clone-sample", buffer, "///")).rejects.toThrow();
  });

  it("rejects a filename that sanitizes to a dotfile", async () => {
    const buffer = new TextEncoder().encode("x").buffer;
    await expect(invoke("voice:save-clone-sample", buffer, ".hidden")).rejects.toThrow();
  });

  it("creates the voice-clones directory on first use", async () => {
    const clonesDir = join(userDataDir, "voice-clones");
    rmSync(clonesDir, { recursive: true, force: true });
    expect(existsSync(clonesDir)).toBe(false);

    const buffer = new TextEncoder().encode("x").buffer;
    await invoke("voice:save-clone-sample", buffer, "again.wav");
    expect(existsSync(clonesDir)).toBe(true);
  });
});

describe("audiobook export — cancellation and file writing", () => {
  it("cancelling before any export started is a safe no-op", async () => {
    await expect(invokeWithSender("voice:cancel-audiobook", { id: 999 })).resolves.toBeUndefined();
  });

  it("writes the file and reports metadata on a normal export", async () => {
    const send = vi.fn();
    const result = await invokeWithSender(
      "voice:export-audiobook",
      { id: 1, send },
      { chapters: [{ text: "ch1" }], lang: "en", voiceId: "v1", title: "My Book", bitrateKbps: 128 },
    );
    expect(result).toMatchObject({ cancelled: false, chapterCount: 1 });
    expect(existsSync(join(userDataDir, "book.mp3"))).toBe(true);
    expect(send).toHaveBeenCalledWith(
      "voice:export-audiobook-progress",
      expect.objectContaining({ phase: "synthesizing" }),
    );
    expect(send).toHaveBeenCalledWith(
      "voice:export-audiobook-progress",
      { phase: "writing" },
    );
  });

  it("does not write a file when the user cancels the save dialog", async () => {
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: undefined });
    const result = await invokeWithSender(
      "voice:export-audiobook",
      { id: 2, send: vi.fn() },
      { chapters: [{ text: "ch1" }], lang: "en", voiceId: "v1", title: "T", bitrateKbps: 128 },
    );
    expect(result).toEqual({ cancelled: true });
  });

  it("reports cancelled without throwing when the export itself is cancelled mid-run", async () => {
    // Cancelling BEFORE the export starts is the "stale flag" case (its own
    // test below) — the handler's own first line is
    // `cancelledExports.delete(senderId)`, which wipes a cancel that arrived
    // earlier. A genuine mid-export cancel has to arrive AFTER that clear, so
    // this triggers it from inside onProgress, which the real handler wires
    // to fire during the export, after that clear has already run.
    const sender = { id: 3, send: vi.fn() };
    audiobookMocks.exportAudiobook.mockImplementationOnce(
      async (opts: { isCancelled: () => boolean; onProgress: (p: unknown) => void }) => {
        opts.onProgress({ phase: "synthesizing", percent: 50 });
        await invokeWithSender("voice:cancel-audiobook", sender); // arrives mid-export
        if (opts.isCancelled()) throw new AudiobookCancelledErrorClass("cancelled mid-export");
        return { mp3: Buffer.from("mp3-bytes"), durationMs: 1000, chapters: [{}] };
      },
    );
    const result = await invokeWithSender(
      "voice:export-audiobook",
      sender,
      { chapters: [{ text: "ch1" }], lang: "en", voiceId: "v1", title: "T", bitrateKbps: 128 },
    );
    expect(result).toEqual({ cancelled: true });
  });

  it("clears a stale cancel flag at the start of a new export on the same window", async () => {
    const sender = { id: 4, send: vi.fn() };
    await invokeWithSender("voice:cancel-audiobook", sender); // cancel a "previous" export
    // A brand new export on the SAME sender id must not inherit that cancel.
    const result = await invokeWithSender(
      "voice:export-audiobook",
      sender,
      { chapters: [{ text: "ch1" }], lang: "en", voiceId: "v1", title: "T", bitrateKbps: 128 },
    );
    expect(result).toMatchObject({ cancelled: false });
  });

  it("cancelling one window's export does not cancel a different window's", async () => {
    const senderA = { id: 5, send: vi.fn() };
    const senderB = { id: 6, send: vi.fn() };
    await invokeWithSender("voice:cancel-audiobook", senderA);

    const resultB = await invokeWithSender(
      "voice:export-audiobook",
      senderB,
      { chapters: [{ text: "ch1" }], lang: "en", voiceId: "v1", title: "T", bitrateKbps: 128 },
    );
    expect(resultB).toMatchObject({ cancelled: false });
  });
});
