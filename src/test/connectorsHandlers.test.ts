// @vitest-environment node
// electron/ipc/connectorsHandlers.ts — CONNECTORS_INVOKE's action switch.
//
// `list` returns the real registry + a merged enable map; `setEnabled` routes
// to the global or the per-project store by scope; `ping` dispatches by the
// connector's `healthKind` (http = a timed fetch, bridged/compute = a static
// verdict, local-native/mcp = a probe on the real subsystem).
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { createElectronMock } from "./helpers/electronMock";
import { CONNECTORS } from "../../shared/agent/connectors";

const electron = createElectronMock();
vi.mock("electron", () => electron);

const globalStore = {
  readGlobalConnectors: vi.fn(() => ({} as Record<string, boolean>)),
  setGlobalConnector: vi.fn((id: string, on: boolean) => ({ [id]: on } as Record<string, boolean>)),
};
vi.mock("../../electron/connectors/globalStore.ts", () => globalStore);

const projectFolder = {
  readConnectors: vi.fn(() => ({} as Record<string, boolean>)),
  setConnector: vi.fn((_root: string, id: string, on: boolean) => ({ [id]: on } as Record<string, boolean>)),
};
vi.mock("../../electron/fs/projectFolder.ts", () => projectFolder);

const mcpClient = { pingRemote: vi.fn(async () => ({ ok: true, latencyMs: 12 })) };
vi.mock("../../electron/tafsir/mcpClient.ts", () => mcpClient);

const shamela = {
  detectShamelaInstallation: vi.fn(
    async (): Promise<{ installed: boolean; path: string | null; reason?: string }> =>
      ({ installed: true, path: "D:\\shamela4" }),
  ),
};

const cloudClient = { pingCloud: vi.fn(async () => ({ ok: null, detail: "Not linked yet — sign in from the شامله لنک panel below." })) };
vi.mock("../../electron/shamela/cloudClient.ts", () => cloudClient);
vi.mock("../../electron/agent/adapters/ganjoor.ts", () => ({ GANJOOR_HEALTH_URL: "https://api.ganjoor.net/api/ganjoor/poets" }));
vi.mock("../../electron/shamela/shamelaNative.ts", () => shamela);

let invoke: (payload: Record<string, unknown>) => Promise<unknown>;

beforeAll(async () => {
  const mod = await import("../../electron/ipc/connectorsHandlers.ts");
  mod.registerConnectorsHandlers();
  invoke = (payload) => electron.invoke("connectors:invoke", payload) as Promise<unknown>;
});

beforeEach(() => {
  vi.clearAllMocks();
  globalStore.readGlobalConnectors.mockReturnValue({});
});

describe("connectorsHandlers", () => {
  it("list returns the real registry plus a merged map with an entry per connector", async () => {
    const r = (await invoke({ action: "list" })) as {
      connectors: unknown[]; merged: Record<string, boolean>;
    };
    expect(r.connectors).toHaveLength(CONNECTORS.length);
    expect(Object.keys(r.merged).sort()).toEqual(CONNECTORS.map((c) => c.id).sort());
    expect(r.merged.shamela).toBe(true);        // defaultOn
    expect(r.merged.repositories).toBe(false);  // defaultOff
  });

  it("setEnabled scope:global writes the global store", async () => {
    await invoke({ action: "setEnabled", id: "shamela", on: false, scope: "global" });
    expect(globalStore.setGlobalConnector).toHaveBeenCalledWith("shamela", false);
    expect(projectFolder.setConnector).not.toHaveBeenCalled();
  });

  it("setEnabled scope:project writes the project manifest", async () => {
    await invoke({ action: "setEnabled", id: "tafsir", on: false, scope: "project", projectRoot: "/p" });
    expect(projectFolder.setConnector).toHaveBeenCalledWith("/p", "tafsir", false);
  });

  it("ping http times a fetch and reports latency", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const r = (await invoke({ action: "ping", id: "repositories" })) as { ok: boolean; latencyMs: number };
    expect(r.ok).toBe(true);
    expect(typeof r.latencyMs).toBe("number");
    fetchSpy.mockRestore();
  });

  it("ping http surfaces an HTTP error, not a throw", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 503 }));
    const r = (await invoke({ action: "ping", id: "repositories" })) as { ok: boolean; error?: string };
    expect(r.ok).toBe(false);
    expect(r.error).toContain("503");
    fetchSpy.mockRestore();
  });

  it("ping turath probes a real endpoint — the bare host answers HTTP 400 and would read as 'down' forever", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const r = (await invoke({ action: "ping", id: "turath" })) as { ok: boolean };
    expect(r.ok).toBe(true);
    const probed = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(probed.hostname).toBe("api.turath.io");
    // the live API 400s on "/" — the probe must hit a real path
    expect(probed.pathname).not.toBe("/");
    expect(probed.pathname).toBe("/author");
    fetchSpy.mockRestore();
  });

  it("ping bridged is 'unknown', not a failure", async () => {
    const r = (await invoke({ action: "ping", id: "hadith" })) as { ok: boolean | null };
    expect(r.ok).toBe(null);
  });

  it("ping mcp (tafsir) uses the MCP client ping", async () => {
    const r = (await invoke({ action: "ping", id: "tafsir" })) as { ok: boolean; latencyMs: number };
    expect(mcpClient.pingRemote).toHaveBeenCalled();
    expect(r.ok).toBe(true);
  });

  it("ping mcp (shamela-cloud) delegates to pingCloud — an unlinked account is null, not an error (ADR-0044)", async () => {
    const r = (await invoke({ action: "ping", id: "shamela-cloud" })) as { ok: boolean | null };
    expect(cloudClient.pingCloud).toHaveBeenCalled();
    expect(r.ok).toBe(null);
  });

  it("ping local-native (shamela) reflects the installation detector", async () => {
    shamela.detectShamelaInstallation.mockResolvedValueOnce({ installed: false, path: null, reason: "no library" });
    const r = (await invoke({ action: "ping", id: "shamela" })) as { ok: boolean };
    expect(r.ok).toBe(false);
  });

  it("an unknown action throws", async () => {
    await expect(invoke({ action: "wat" })).rejects.toThrow();
  });
});
