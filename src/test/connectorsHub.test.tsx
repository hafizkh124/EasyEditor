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
  it("renders a card per connector, grouped, from the IPC list", async () => {
    win.electronAPI = { connectors: makeApi() };
    render(<ConnectorsHub />);
    for (const c of CONNECTORS) {
      expect(await screen.findByText(c.label)).toBeInTheDocument();
    }
  });

  it("renders nothing when there is no desktop connectors API", () => {
    const { container } = render(<ConnectorsHub />);
    expect(container).toBeEmptyDOMElement();
  });

  it("toggling a connector calls setEnabled with global scope", async () => {
    const api = makeApi();
    win.electronAPI = { connectors: api };
    render(<ConnectorsHub />);
    const shamelaLabel = CONNECTORS.find((c) => c.id === "shamela")!.label;
    const shamela = await screen.findByLabelText(shamelaLabel);
    fireEvent.click(shamela);
    await waitFor(() => expect(api.setEnabled).toHaveBeenCalledWith("shamela", false, "global"));
  });

  it("a disabled connector shows in the Add dialog, and enabling it calls setEnabled(true)", async () => {
    const global = { shamela: false };
    const api = makeApi({
      list: vi.fn(async () => ({
        connectors: CONNECTORS, global, project: {},
        merged: mergeConnectorState(global, {}),
      })),
    });
    win.electronAPI = { connectors: api };
    render(<ConnectorsHub />);
    fireEvent.click(await screen.findByText("Add a connector"));
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
    expect(await screen.findByText("Sign-in needed")).toBeInTheDocument();
    expect(screen.queryByText("Error")).not.toBeInTheDocument();
  });
});
