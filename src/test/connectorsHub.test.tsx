import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { ConnectorsHub } from "@/components/settings/ConnectorsHub";
import { CONNECTORS, mergeConnectorState } from "~shared/agent/connectors";

/**
 * Connectors Hub — the Settings grid over the curated registry. The list and
 * enable state come from `window.electronAPI.connectors` (never hard-coded in
 * the renderer); toggling calls `setEnabled(id, on, 'global')`; "Test" calls
 * `ping(id)`.
 */
const win = window as unknown as Record<string, unknown>;

function makeApi(overrides: Record<string, unknown> = {}) {
  const global: Record<string, boolean> = {};
  return {
    list: vi.fn(async () => ({
      connectors: CONNECTORS,
      global,
      project: {},
      merged: mergeConnectorState(global, {}),
    })),
    setEnabled: vi.fn(async (id: string, on: boolean) => {
      if (on) delete global[id]; else global[id] = false;
      return { global };
    }),
    ping: vi.fn(async () => ({ ok: true, latencyMs: 42 })),
    ...overrides,
  };
}

afterEach(() => {
  delete win.electronAPI;
  cleanup();
  vi.clearAllMocks();
});

describe("ConnectorsHub", () => {
  it("renders a card for every enabled, non-advanced connector under My connectors", async () => {
    win.electronAPI = { connectors: makeApi() };
    render(<ConnectorsHub />);
    const merged = mergeConnectorState({}, {});
    for (const c of CONNECTORS.filter((x) => merged[x.id] && !x.advanced)) {
      expect(await screen.findByText(c.label)).toBeInTheDocument();
    }
  });

  it("keeps the Shamela transports and the unused connectors out of sight until asked", async () => {
    win.electronAPI = { connectors: makeApi() };
    render(<ConnectorsHub />);
    await screen.findByText("My connectors (", { exact: false });
    expect(screen.queryByText(CONNECTORS.find((c) => c.id === "shamela")!.label)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Advanced: Shamela on this computer"));
    expect(await screen.findByText(CONNECTORS.find((c) => c.id === "shamela")!.label)).toBeInTheDocument();
  });

  it("a preset only switches ON what is off and leaves the rest alone", async () => {
    const global = { ganjoor: false } as Record<string, boolean>;
    const api = makeApi({
      list: vi.fn(async () => ({
        connectors: CONNECTORS, global, project: {},
        merged: { ...mergeConnectorState(global, {}), lexicon: false, ganjoor: false, "urdu-prosody": true },
      })),
    });
    win.electronAPI = { connectors: api };
    render(<ConnectorsHub />);
    fireEvent.click(await screen.findByRole("button", { name: /Literature & poetry/ }));
    await waitFor(() => expect(api.setEnabled).toHaveBeenCalledWith("lexicon", true, "global"));
    expect(api.setEnabled).toHaveBeenCalledWith("ganjoor", true, "global");
    expect(api.setEnabled).not.toHaveBeenCalledWith("urdu-prosody", expect.anything(), expect.anything());
    for (const call of api.setEnabled.mock.calls) expect(call[1]).toBe(true);
  });

  it("renders nothing when there is no desktop connectors API", () => {
    const { container } = render(<ConnectorsHub />);
    expect(container).toBeEmptyDOMElement();
  });

  it("toggling a connector calls setEnabled with global scope", async () => {
    const api = makeApi();
    win.electronAPI = { connectors: api };
    render(<ConnectorsHub />);
    const tafsirLabel = CONNECTORS.find((c) => c.id === "tafsir")!.label;
    const tafsir = await screen.findByLabelText(tafsirLabel);
    fireEvent.click(tafsir);
    await waitFor(() => expect(api.setEnabled).toHaveBeenCalledWith("tafsir", false, "global"));
  });

  it("a disabled connector shows in the Library, and enabling it calls setEnabled(true)", async () => {
    const global = { tafsir: false };
    const api = makeApi({
      list: vi.fn(async () => ({
        connectors: CONNECTORS, global, project: {},
        merged: mergeConnectorState(global, {}),
      })),
    });
    win.electronAPI = { connectors: api };
    render(<ConnectorsHub />);
    fireEvent.click(await screen.findByText("Library (", { exact: false }));
    const enableButtons = await screen.findAllByText("Enable");
    fireEvent.click(enableButtons[0]);
    await waitFor(() => expect(api.setEnabled).toHaveBeenCalledWith(expect.any(String), true, "global"));
  });

  it("Test ping calls the connector ping", async () => {
    const api = makeApi();
    win.electronAPI = { connectors: api };
    render(<ConnectorsHub />);
    const buttons = await screen.findAllByText("Test");
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(api.ping).toHaveBeenCalled());
  });

  it("an MCP connector whose ping returns ok:null shows 'Sign-in needed', not an error", async () => {
    const global = { "shamela-cloud": true };
    const api = makeApi({
      list: vi.fn(async () => ({
        connectors: CONNECTORS, global, project: {},
        merged: mergeConnectorState(global, {}),
      })),
      ping: vi.fn(async (id: string) =>
        id === "shamela-cloud" ? { ok: null, detail: "Not linked yet — sign in from the شامله لنک panel below." } : { ok: true, latencyMs: 5 },
      ),
    });
    win.electronAPI = { connectors: api };
    render(<ConnectorsHub />);
    fireEvent.click(await screen.findByText("Advanced: Shamela on this computer"));
    expect(await screen.findByText("Sign-in needed")).toBeInTheDocument();
    expect(screen.queryByText("Error")).not.toBeInTheDocument();
  });
});
