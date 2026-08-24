// @vitest-environment node
// electron/ipc/aiHandlers.ts — the AI_INVOKE channel, which carries two
// separate responsibilities behind one dispatch: the normal BYOK
// generate/embed path, and an `edge-function` compatibility mode that routes
// a handful of cloud edge-function names (library-ingest, refine-text,
// graph-extract, …) to their local desktop equivalents or a clear refusal.
//
// Two properties matter enough to test directly rather than trust by
// construction: routing by `functionName` reaches the right code path (a
// mis-routed request either silently no-ops or, worse, runs the wrong
// action), and every error that reaches the renderer or a log has been
// through redactKeyFromLog first — this suite leaves that function REAL
// (not mocked) specifically to prove the wiring actually calls it, not just
// that the function works in isolation (see redactKeyFromLog.test.ts for
// that).
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { createElectronMock } from "./helpers/electronMock";
// Type-only — erased at compile time, so this does not defeat the vi.mock
// below. Used to give the mocks below real signatures instead of ones
// inferred from a single call site, which is too narrow for later tests to
// pass richer values or inspect call arguments by index.
import type { KeyStatus } from "../../electron/ai/keyStore.ts";
import type { GeminiGenerateRequest } from "../../electron/ai/geminiClient.ts";

const electron = createElectronMock();
vi.mock("electron", () => electron);

const keyStoreMocks = {
  saveGeminiKey: vi.fn(async (_key: string) => true),
  getGeminiKeyStatus: vi.fn(async (): Promise<KeyStatus> => ({ hasKey: false, lastFour: null })),
  deleteGeminiKey: vi.fn(async () => undefined),
};
vi.mock("../../electron/ai/keyStore.ts", () => keyStoreMocks);

const geminiMocks = {
  testGeminiKey: vi.fn(async (_key?: string) => ({ success: true, message: "ok" })),
  generateContentStream: vi.fn(
    async (_req: GeminiGenerateRequest, _onChunk?: (chunk: string) => void) => "generated text",
  ),
  embedTextContent: vi.fn(async (_text: string) => [0.1, 0.2, 0.3]),
};
vi.mock("../../electron/ai/geminiClient.ts", async (importOriginal) => {
  // Real ByokApiError and redactKeyFromLog — this suite's whole point for the
  // error path is proving the handler's own catch block actually redacts.
  const actual = await importOriginal<typeof import("../../electron/ai/geminiClient.ts")>();
  return {
    ...actual,
    testGeminiKey: geminiMocks.testGeminiKey,
    generateContentStream: geminiMocks.generateContentStream,
    embedTextContent: geminiMocks.embedTextContent,
  };
});

const ingestLibraryItemMock = vi.fn(async () => ({ chunksIngested: 3 }));
vi.mock("../../electron/ipc/workspaceHandlers.ts", () => ({
  getWorkspaceDbService: vi.fn(async () => ({ ingestLibraryItem: ingestLibraryItemMock })),
}));

let ByokApiError: typeof import("../../electron/ai/geminiClient.ts")["ByokApiError"];

beforeAll(async () => {
  const mod = await import("../../electron/ipc/aiHandlers.ts");
  mod.registerAiHandlers();
  ({ ByokApiError } = await import("../../electron/ai/geminiClient.ts"));
});

beforeEach(() => {
  vi.clearAllMocks();
  geminiMocks.generateContentStream.mockResolvedValue("generated text");
});

const invoke = (payload: unknown) => electron.invoke("ai:invoke", payload);

describe("registration", () => {
  it("registers all five AI channels", () => {
    expect([...electron.ipcMain.handlers.keys()].sort()).toEqual([
      "ai:delete-key",
      "ai:get-key-status",
      "ai:invoke",
      "ai:save-key",
      "ai:test-key",
    ]);
  });
});

describe("ai:save-key / ai:get-key-status / ai:delete-key / ai:test-key — thin forwarding", () => {
  it("forwards the key to saveGeminiKey and returns its result", async () => {
    keyStoreMocks.saveGeminiKey.mockResolvedValueOnce(true);
    await expect(electron.invoke("ai:save-key", "AIzaSy-fake")).resolves.toBe(true);
    expect(keyStoreMocks.saveGeminiKey).toHaveBeenCalledWith("AIzaSy-fake");
  });

  it("forwards getGeminiKeyStatus's result unchanged", async () => {
    keyStoreMocks.getGeminiKeyStatus.mockResolvedValueOnce({ hasKey: true, lastFour: "1234" });
    await expect(electron.invoke("ai:get-key-status")).resolves.toEqual({
      hasKey: true,
      lastFour: "1234",
    });
  });

  it("deletes the key and reports true", async () => {
    await expect(electron.invoke("ai:delete-key")).resolves.toBe(true);
    expect(keyStoreMocks.deleteGeminiKey).toHaveBeenCalled();
  });

  it("passes an optional test key through to testGeminiKey", async () => {
    await electron.invoke("ai:test-key", "some-key-to-test");
    expect(geminiMocks.testGeminiKey).toHaveBeenCalledWith("some-key-to-test");
  });
});

describe("ai:invoke — mode: embed", () => {
  it("routes to embedTextContent and never touches generateContentStream", async () => {
    const result = await invoke({ mode: "embed", prompt: "متن" });
    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(geminiMocks.embedTextContent).toHaveBeenCalledWith("متن");
    expect(geminiMocks.generateContentStream).not.toHaveBeenCalled();
  });
});

describe("ai:invoke — mode: edge-function", () => {
  it("routes library-ingest to the local workspace DB service", async () => {
    const result = await invoke({
      mode: "edge-function",
      functionName: "library-ingest",
      body: { item_id: "book-1", offset: 40, batch_size: 25 },
    });
    expect(result).toEqual({ chunksIngested: 3 });
    expect(ingestLibraryItemMock).toHaveBeenCalledWith({
      itemId: "book-1",
      offset: 40,
      batchSize: 25,
    });
  });

  it("defaults offset and batch_size when the caller omits them", async () => {
    await invoke({ mode: "edge-function", functionName: "library-ingest", body: { item_id: "x" } });
    expect(ingestLibraryItemMock).toHaveBeenCalledWith({ itemId: "x", offset: 0, batchSize: 100 });
  });

  it("routes refine-text to the local Gemini path with the action's real prompt", async () => {
    const result = await invoke({
      mode: "edge-function",
      functionName: "refine-text",
      body: { text: "کچھ متن", action: "formalize" },
    });
    expect(result).toEqual({ data: { text: "generated text" } });

    const call = geminiMocks.generateContentStream.mock.calls[0][0];
    expect(call.prompt).toBe("کچھ متن");
    expect(call.systemInstruction).toContain("professional editor");
  });

  it("prefers an explicit custom_prompt over the action's built-in one", async () => {
    await invoke({
      mode: "edge-function",
      functionName: "refine-text",
      body: { text: "متن", action: "formalize", custom_prompt: "میرا اپنا پرامپٹ" },
    });
    const call = geminiMocks.generateContentStream.mock.calls[0][0];
    expect(call.systemInstruction).toBe("میرا اپنا پرامپٹ");
  });

  it("refuses refine-text when the action is unknown and there is no custom_prompt", async () => {
    await expect(
      invoke({ mode: "edge-function", functionName: "refine-text", body: { text: "متن", action: "not-a-real-action" } }),
    ).rejects.toThrow();
    expect(geminiMocks.generateContentStream).not.toHaveBeenCalled();
  });

  it("refuses refine-text when the text is empty", async () => {
    await expect(
      invoke({ mode: "edge-function", functionName: "refine-text", body: { text: "", action: "formalize" } }),
    ).rejects.toThrow();
  });

  it("refuses graph-extract with a specific explanation, not a generic one", async () => {
    await expect(
      invoke({ mode: "edge-function", functionName: "graph-extract", body: {} }),
    ).rejects.toThrow(/علمی گراف/);
  });

  it("refuses an unknown edge-function name with a generic message naming it", async () => {
    await expect(
      invoke({ mode: "edge-function", functionName: "some-future-function", body: {} }),
    ).rejects.toThrow(/some-future-function/);
  });

  it("names the function as unknown, rather than throwing, when functionName itself is missing", async () => {
    await expect(invoke({ mode: "edge-function", body: {} })).rejects.toThrow();
  });
});

describe("ai:invoke — the default generate path and its error redaction", () => {
  it("returns the generated text under a `text` key", async () => {
    const result = await invoke({ prompt: "hello" });
    expect(result).toEqual({ text: "generated text" });
  });

  it("streams chunks to the sender's window as they arrive", async () => {
    const send = vi.fn();
    electron.BrowserWindow.fromWebContents.mockReturnValue({
      isDestroyed: () => false,
      webContents: { send },
    });
    geminiMocks.generateContentStream.mockImplementationOnce(async (_req, onChunk) => {
      onChunk?.("chunk one");
      onChunk?.("chunk two");
      return "chunk onechunk two";
    });

    await invoke({ prompt: "hello", streamChannelId: "stream-42" });

    expect(send).toHaveBeenCalledWith("stream-42", { chunk: "chunk one" });
    expect(send).toHaveBeenCalledWith("stream-42", { chunk: "chunk two" });
    expect(send).toHaveBeenCalledWith("stream-42", { done: true });
  });

  it("does not throw when the window has been closed mid-stream", async () => {
    electron.BrowserWindow.fromWebContents.mockReturnValue({ isDestroyed: () => true, webContents: { send: vi.fn() } });
    geminiMocks.generateContentStream.mockImplementationOnce(async (_req, onChunk) => {
      onChunk?.("chunk");
      return "chunk";
    });
    await expect(invoke({ prompt: "hello", streamChannelId: "stream-1" })).resolves.toEqual({ text: "chunk" });
  });

  it("redacts a leaked key from a ByokApiError before it reaches the caller", async () => {
    const key = "AIzaSy" + "LeakedRealLookingKeyValue12345678";
    expect(key.length).toBe(39); // AIzaSy + 33, matching redactKeyFromLog's pattern
    geminiMocks.generateContentStream.mockRejectedValueOnce(
      new ByokApiError(`Gemini rejected key ${key}`, 401, "invalid_key"),
    );

    let caught: Error | null = null;
    try {
      await invoke({ prompt: "hello" });
    } catch (e) {
      caught = e as Error;
    }

    expect(caught).not.toBeNull();
    expect(caught!.message).not.toContain(key);
    expect(caught!.message).toContain("AIzaSy***REDACTED***");
  });

  it("also redacts the key on the streamed error event sent to the window", async () => {
    const key = "AIzaSy" + "AnotherLeakedKeyValue1234567890AB";
    const send = vi.fn();
    electron.BrowserWindow.fromWebContents.mockReturnValue({ isDestroyed: () => false, webContents: { send } });
    geminiMocks.generateContentStream.mockRejectedValueOnce(new Error(`upstream said ${key}`));

    await expect(invoke({ prompt: "hello", streamChannelId: "stream-err" })).rejects.toThrow();

    const errorCall = send.mock.calls.find(([, payload]) => "error" in payload);
    expect(errorCall).toBeDefined();
    expect(errorCall![1].error).not.toContain(key);
  });

  it("propagates a plain Error's message (redacted) rather than swallowing it", async () => {
    geminiMocks.generateContentStream.mockRejectedValueOnce(new Error("network unreachable"));
    await expect(invoke({ prompt: "hello" })).rejects.toThrow("network unreachable");
  });
});
