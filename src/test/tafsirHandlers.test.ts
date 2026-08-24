// @vitest-environment node
// electron/ipc/tafsirHandlers.ts — TAFSIR_INVOKE's action switch.
//
// Switch-based dispatch (not the `service[name]` pattern workspaceHandlers.ts
// had to guard against), so the risk here is different: install-flow state
// machine correctness, not prototype pollution. The comment at 'connect'
// names the property that matters most — "Principle 5: never let `uvx
// tafsir-mcp` silently download ~214 MB" — a local connect attempt must
// refuse rather than trigger a large, unannounced download. install:start /
// install:cancel share module-level state across calls, which is exactly the
// kind of thing that is easy to get subtly wrong (a cancelled download that
// leaves state stuck on "downloading" forever, a second start that restarts
// an already-running download) and impossible to see from reading the
// function in isolation.
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { createElectronMock } from "./helpers/electronMock";
// Type-only — erased at compile time, gives the mocks below the real return
// shapes so later `.mockReturnValue({...})` calls with different field values
// (e.g. `dbPath: string` vs the first literal's `dbPath: null`) typecheck,
// instead of TS locking the mock to whatever the first inline literal implied.
import type { TafsirDetectResult } from "../../electron/tafsir/types.ts";
import type { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";

const electron = createElectronMock();
electron.app.getPath = vi.fn(() => "/fake/userData");
vi.mock("electron", () => electron);

const runtimeMocks = {
  detect: vi.fn(
    (): TafsirDetectResult => ({
      pythonFound: true,
      pythonVersion: "3.11.0",
      uvFound: true,
      uvVersion: "0.4.0",
      dbFound: false,
      dbPath: null,
      errors: [],
    }),
  ),
  buildStdioParams: vi.fn(
    (): StdioServerParameters | null => ({ command: "uvx", args: ["tafsir-mcp"] }),
  ),
  downloadDatabase: vi.fn(async () => "/fake/userData/tafsir/quran.db"),
  cleanup: vi.fn(),
};
vi.mock("../../electron/tafsir/localRuntime.ts", () => ({
  getLocalRuntime: () => runtimeMocks,
  TAFSIR_DB_SIZE_MB: 214,
}));

const mcpMocks = {
  connectRemote: vi.fn(async () => ({ connected: true, mode: "remote" })),
  connectLocal: vi.fn(async () => ({ connected: true, mode: "local" })),
  disconnect: vi.fn(async () => undefined),
  listTools: vi.fn(async () => [{ name: "search_tafsir" }]),
  ping: vi.fn(async () => ({ ok: true, latencyMs: 5 })),
  pingRemote: vi.fn(async () => ({ ok: true, latencyMs: 40 })),
  callTool: vi.fn(async () => ({ ok: true, result: "tool ran" })),
};
vi.mock("../../electron/tafsir/mcpClient.ts", () => mcpMocks);

let mod: typeof import("../../electron/ipc/tafsirHandlers.ts");

beforeAll(async () => {
  mod = await import("../../electron/ipc/tafsirHandlers.ts");
  mod.registerTafsirHandlers();
});

beforeEach(() => {
  vi.clearAllMocks();
  runtimeMocks.detect.mockReturnValue({
    pythonFound: true,
    pythonVersion: "3.11.0",
    uvFound: true,
    uvVersion: "0.4.0",
    dbFound: false,
    dbPath: null,
    errors: [],
  });
  runtimeMocks.buildStdioParams.mockReturnValue({ command: "uvx", args: ["tafsir-mcp"] });
  runtimeMocks.downloadDatabase.mockResolvedValue("/fake/userData/tafsir/quran.db");
  mcpMocks.pingRemote.mockResolvedValue({ ok: true, latencyMs: 40 });
});

const invoke = (payload: Record<string, unknown>) => electron.invoke("tafsir:invoke", payload);

describe("registration", () => {
  it("registers the single tafsir:invoke channel", () => {
    expect([...electron.ipcMain.handlers.keys()]).toEqual(["tafsir:invoke"]);
  });
});

describe("simple forwarding actions", () => {
  it("ping defaults to remote", async () => {
    await invoke({ action: "ping" });
    expect(mcpMocks.pingRemote).toHaveBeenCalled();
    expect(mcpMocks.ping).not.toHaveBeenCalled();
  });

  it("ping with mode: local pings the local runtime instead", async () => {
    await invoke({ action: "ping", mode: "local" });
    expect(mcpMocks.ping).toHaveBeenCalled();
    expect(mcpMocks.pingRemote).not.toHaveBeenCalled();
  });

  it("detect returns the runtime's detection result directly", async () => {
    await expect(invoke({ action: "detect" })).resolves.toMatchObject({ pythonFound: true });
  });

  it("diagnose merges local detection with a live remote ping", async () => {
    const result = await invoke({ action: "diagnose" });
    expect(result).toMatchObject({ pythonFound: true, remoteReachable: true, remoteLatencyMs: 40 });
  });

  it("disconnect calls through and reports disconnected", async () => {
    await expect(invoke({ action: "disconnect" })).resolves.toEqual({ disconnected: true });
    expect(mcpMocks.disconnect).toHaveBeenCalled();
  });

  it("tools forwards to listTools", async () => {
    await expect(invoke({ action: "tools" })).resolves.toEqual([{ name: "search_tafsir" }]);
  });

  it("call forwards the tool name and arguments", async () => {
    await invoke({ action: "call", tool: "search_tafsir", arguments: { q: "بقرة" } });
    expect(mcpMocks.callTool).toHaveBeenCalledWith("search_tafsir", { q: "بقرة" });
  });

  it("rejects an unknown action, naming it", async () => {
    await expect(invoke({ action: "not-a-real-action" })).rejects.toThrow(/not-a-real-action/);
  });
});

describe("connect — never silently downloads", () => {
  it("connects remote by default", async () => {
    await invoke({ action: "connect" });
    expect(mcpMocks.connectRemote).toHaveBeenCalled();
  });

  it("refuses a local connect when the database has not been downloaded", async () => {
    runtimeMocks.detect.mockReturnValue({
      pythonFound: true, pythonVersion: "3.11", uvFound: true, uvVersion: "0.4",
      dbFound: false, dbPath: null, errors: [],
    });
    await expect(invoke({ action: "connect", mode: "local" })).rejects.toThrow();
    expect(mcpMocks.connectLocal).not.toHaveBeenCalled();
  });

  it("refuses a local connect when Python/uv cannot be found, even if the DB exists", async () => {
    runtimeMocks.detect.mockReturnValue({
      pythonFound: false, pythonVersion: null, uvFound: false, uvVersion: null,
      dbFound: true, dbPath: "/fake/db", errors: ["python not found"],
    });
    runtimeMocks.buildStdioParams.mockReturnValue(null);
    await expect(invoke({ action: "connect", mode: "local" })).rejects.toThrow();
  });

  it("connects local when the database is present and the stdio params build successfully", async () => {
    runtimeMocks.detect.mockReturnValue({
      pythonFound: true, pythonVersion: "3.11", uvFound: true, uvVersion: "0.4",
      dbFound: true, dbPath: "/fake/db", errors: [],
    });
    await invoke({ action: "connect", mode: "local" });
    expect(mcpMocks.connectLocal).toHaveBeenCalledWith({ command: "uvx", args: ["tafsir-mcp"] });
  });
});

describe("the install state machine", () => {
  it("reports idle before any install has started", async () => {
    await expect(invoke({ action: "install:status" })).resolves.toMatchObject({ state: "idle" });
  });

  it("short-circuits to done without downloading when the database is already present", async () => {
    runtimeMocks.detect.mockReturnValue({
      pythonFound: true, pythonVersion: "3.11", uvFound: true, uvVersion: "0.4",
      dbFound: true, dbPath: "/fake/db", errors: [],
    });
    const result = await invoke({ action: "install:start" });
    expect(result).toMatchObject({ state: "done", percent: 100 });
    expect(runtimeMocks.downloadDatabase).not.toHaveBeenCalled();
  });

  it("refuses to start without Python/uv", async () => {
    runtimeMocks.detect.mockReturnValue({
      pythonFound: false, pythonVersion: null, uvFound: true, uvVersion: "0.4",
      dbFound: false, dbPath: null, errors: [],
    });
    await expect(invoke({ action: "install:start" })).rejects.toThrow();
    expect(runtimeMocks.downloadDatabase).not.toHaveBeenCalled();
  });

  it("reports done and 100% after a successful download", async () => {
    const result = await invoke({ action: "install:start" });
    expect(result).toMatchObject({ state: "done", percent: 100 });
    await expect(invoke({ action: "install:status" })).resolves.toMatchObject({ state: "done" });
  });

  it("streams progress events to the requesting window as the download proceeds", async () => {
    const send = vi.fn();
    runtimeMocks.downloadDatabase.mockImplementationOnce(async (opts?: { onProgress?: (p: unknown) => void }) => {
      opts?.onProgress?.({ state: "downloading", downloadedBytes: 1000, totalBytes: 2000, percent: 50 });
      return "/fake/db";
    });
    // Bypasses electron.invoke()'s fixed `{ sender: null }` event — this
    // handler is the one place in the file that reads `event.sender`, so it
    // needs a real-shaped sender to send progress events through.
    const res = await electron.ipcMain.handlers.get("tafsir:invoke")!(
      { sender: { send } },
      { action: "install:start" },
    );
    expect(send).toHaveBeenCalledWith(
      "tafsir:install-progress",
      expect.objectContaining({ percent: 50 }),
    );
    expect(res).toMatchObject({ state: "done" });
  });

  it("does not restart an already-running download", async () => {
    let resolveDownload!: (path: string) => void;
    runtimeMocks.downloadDatabase.mockImplementationOnce(
      () => new Promise<string>((resolve) => { resolveDownload = resolve; }),
    );

    const first = invoke({ action: "install:start" });
    // A second call arrives while the first is still in flight.
    const second = await invoke({ action: "install:start" });
    expect(second).toMatchObject({ state: "downloading" });
    expect(runtimeMocks.downloadDatabase).toHaveBeenCalledTimes(1);

    resolveDownload("/fake/db");
    await first;
  });

  it("on a genuine download failure, reports state: error with a message and rethrows", async () => {
    runtimeMocks.downloadDatabase.mockRejectedValueOnce(new Error("checksum mismatch"));
    await expect(invoke({ action: "install:start" })).rejects.toThrow("checksum mismatch");
    await expect(invoke({ action: "install:status" })).resolves.toMatchObject({
      state: "error",
      error: "checksum mismatch",
    });
  });

  it("on a cancelled download, reports state: idle and does NOT rethrow", async () => {
    let capturedSignal: AbortSignal | undefined;
    runtimeMocks.downloadDatabase.mockImplementationOnce(
      (opts?: { signal?: AbortSignal }) =>
        new Promise<string>((_resolve, reject) => {
          capturedSignal = opts?.signal;
          capturedSignal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );

    const startPromise = invoke({ action: "install:start" });
    await invoke({ action: "install:cancel" });
    const result = await startPromise;

    expect(result).toMatchObject({ state: "idle", percent: 0 });
    await expect(invoke({ action: "install:status" })).resolves.toMatchObject({ state: "idle" });
  });

  it("install:cancel is a safe no-op when nothing is downloading", async () => {
    await expect(invoke({ action: "install:cancel" })).resolves.toEqual({ cancelled: true });
  });
});
