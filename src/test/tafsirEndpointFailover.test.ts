// @vitest-environment node
// electron/tafsir/mcpClient.ts — ADR-0039. Markaz Tafsir serves the same MCP
// server behind mcp.tafsir.net and bahouth.tafsir.net; connectRemote /
// pingRemote try REMOTE_ENDPOINTS in order and use the first that answers.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { REMOTE_ENDPOINTS } from '../../electron/tafsir/allowlist';

// ── mock the MCP SDK so we control which endpoint "connects" ──────────────
const transportUrls: string[] = [];

class FakeStreamableTransport {
  url: string;
  constructor(url: URL) { this.url = url.toString(); transportUrls.push(this.url); }
  close = vi.fn(async () => {});
}
class FakeStdioTransport {
  pid = 123;
  close = vi.fn(async () => {});
}

/** Endpoints (by URL) whose connect should fail. Reset per test. */
let failUrls = new Set<string>();

class FakeClient {
  async connect(transport: FakeStreamableTransport | FakeStdioTransport) {
    if (transport instanceof FakeStreamableTransport && failUrls.has(transport.url)) {
      throw new Error(`connect refused for ${transport.url}`);
    }
  }
  async listTools() { return { tools: [{ name: 'fetch_ayah' }] }; }
  getServerVersion() { return { name: 'tafsir-mcp', version: '1.0.0' }; }
  async ping() {}
  async close() {}
}

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: FakeClient }));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: FakeStreamableTransport }));
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({ StdioClientTransport: FakeStdioTransport }));

let mod: typeof import('../../electron/tafsir/mcpClient');

beforeEach(async () => {
  vi.clearAllMocks();
  transportUrls.length = 0;
  failUrls = new Set();
  mod = await import('../../electron/tafsir/mcpClient');
  await mod.disconnect();
});

describe('connectRemote endpoint failover', () => {
  it('uses the primary endpoint when it connects', async () => {
    const r = await mod.connectRemote();
    expect(r.endpoint).toBe(REMOTE_ENDPOINTS[0]);
    expect(mod.currentEndpoint()).toBe(REMOTE_ENDPOINTS[0]);
  });

  it('falls back to bahouth.tafsir.net when the primary refuses', async () => {
    failUrls = new Set([REMOTE_ENDPOINTS[0]]);
    const r = await mod.connectRemote();
    expect(r.endpoint).toBe(REMOTE_ENDPOINTS[1]);
    expect(mod.currentEndpoint()).toBe(REMOTE_ENDPOINTS[1]);
    expect(transportUrls).toEqual([...REMOTE_ENDPOINTS]); // tried both, in order
  });

  it('throws the last error when every endpoint refuses', async () => {
    failUrls = new Set(REMOTE_ENDPOINTS);
    await expect(mod.connectRemote()).rejects.toThrow(/connect refused/);
    expect(mod.currentEndpoint()).toBeNull();
  });
});

describe('pingRemote', () => {
  it('reports ok from the first endpoint that answers (fallback on a 503)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      return new Response('', { status: url === REMOTE_ENDPOINTS[0] ? 503 : 200 });
    });
    const r = await mod.pingRemote();
    expect(r.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    fetchSpy.mockRestore();
  });

  it('reports the last error when both endpoints fail', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
    const r = await mod.pingRemote();
    expect(r.ok).toBe(false);
    expect(r.error).toContain('500');
    fetchSpy.mockRestore();
  });
});
