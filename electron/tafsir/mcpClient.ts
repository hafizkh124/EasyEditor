/**
 * Tafsir MCP — client core (SPEC-TAFSIR §FR-1).
 *
 * Wraps the MCP SDK `Client` over two transports:
 *   - remote:  StreamableHTTPClientTransport → https://mcp.tafsir.net/mcp (stateless)
 *   - local:   StdioClientTransport → `uvx tafsir-mcp` subprocess
 *
 * Every renderer-facing tool call is gated by the allowlist + arg sanitizer
 * (§FR-1.2 / NFR-2) and runs inside a per-mode timeout (NFR-1). This module
 * has no electron dependency so its pure parts stay unit-testable.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport, type StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import { REMOTE_ENDPOINT, validateToolArgs, MAX_RESULT_CHARS } from './allowlist.js';
import type {
  TafsirConnectResult,
  TafsirCallResult,
  TafsirPingResult,
  TafsirToolInfo,
  TafsirMode,
} from './types.js';

const TIMEOUT_MS: Record<TafsirMode, number> = { remote: 15_000, local: 30_000 };

interface ActiveSession {
  mode: TafsirMode;
  client: Client;
  transport: StreamableHTTPClientTransport | StdioClientTransport;
}

let session: ActiveSession | null = null;
/** pid of the spawned stdio child (if any) — kept for synchronous teardown. */
let localChildPid: number | null = null;

function toToolInfo(
  tools: Array<{ name: string; title?: string; description?: string; inputSchema?: Record<string, unknown> }>,
): TafsirToolInfo[] {
  return tools.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

export function isConnected(): boolean {
  return session !== null;
}

export function currentMode(): TafsirMode | null {
  return session?.mode ?? null;
}

function withTimeout<T>(promise: Promise<T>, mode: TafsirMode): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            mode === 'remote'
              ? 'ریموٹ سرور نے جواب دینے میں بہت وقت دیا۔'
              : 'مقامی سرور نے جواب دینے میں بہت وقت دیا۔',
          ),
        ),
      TIMEOUT_MS[mode],
    );
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/** Lightweight, connection-less health check for the remote endpoint. */
export async function pingRemote(): Promise<TafsirPingResult> {
  const started = Date.now();
  try {
    const res = await fetch(REMOTE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'User-Agent': 'easy-editor-tafsir/1.0.0',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'easy-editor-tafsir', version: '1.0.0' },
        },
      }),
    });
    if (res.status >= 400) {
      return { ok: false, mode: 'remote', latencyMs: null, error: `HTTP ${res.status}` };
    }
    return { ok: true, mode: 'remote', latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      mode: 'remote',
      latencyMs: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function connectRemote(): Promise<TafsirConnectResult> {
  await disconnect();
  const client = new Client({ name: 'easy-editor-tafsir', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(REMOTE_ENDPOINT));
  await withTimeout(client.connect(transport), 'remote');
  const tools = await withTimeout(client.listTools(), 'remote');
  const server = client.getServerVersion();
  session = { mode: 'remote', client, transport };
  return {
    mode: 'remote',
    connected: true,
    server: server?.name,
    version: server?.version,
    tools: toToolInfo(tools.tools),
  };
}

export async function connectLocal(params: StdioServerParameters): Promise<TafsirConnectResult> {
  await disconnect();
  const client = new Client({ name: 'easy-editor-tafsir', version: '1.0.0' });
  const transport = new StdioClientTransport(params);
  try {
    await withTimeout(client.connect(transport), 'local');
  } catch (err) {
    try { await transport.close(); } catch { /* ignore */ }
    throw err;
  }
  const tools = await withTimeout(client.listTools(), 'local');
  const server = client.getServerVersion();
  session = { mode: 'local', client, transport };
  localChildPid = transport.pid;
  return {
    mode: 'local',
    connected: true,
    server: server?.name,
    version: server?.version,
    tools: toToolInfo(tools.tools),
  };
}

export async function disconnect(): Promise<void> {
  if (!session) return;
  const { client, transport } = session;
  session = null;
  localChildPid = null;
  try { await client.close(); } catch { /* ignore */ }
  try { await transport.close(); } catch { /* ignore */ }
}

/**
 * Synchronous child teardown for app-quit paths (`before-quit` does not await
 * promises). Kills the spawned stdio process if one is live.
 */
export function terminateLocalSync(): void {
  if (localChildPid !== null) {
    try { process.kill(localChildPid); } catch { /* already gone */ }
    localChildPid = null;
  }
  if (session?.mode === 'local' && session.transport instanceof StdioClientTransport) {
    try { session.transport.close(); } catch { /* ignore */ }
  }
}

export async function listTools(): Promise<TafsirToolInfo[]> {
  if (!session) throw new Error('Tafsir MCP منسلک نہیں ہے۔');
  const tools = await withTimeout(session.client.listTools(), session.mode);
  return toToolInfo(tools.tools);
}

export async function ping(): Promise<TafsirPingResult> {
  if (!session) return pingRemote();
  const started = Date.now();
  try {
    await withTimeout(session.client.ping(), session.mode);
    return { ok: true, mode: session.mode, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      mode: session.mode,
      latencyMs: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Calls an allowlisted tool. Arguments are sanitized here (defence in depth —
 * the handler re-validates too), so even the main process cannot bypass the
 * schema. Returns renderer-friendly text.
 */
export async function callTool(name: string, rawArgs: unknown): Promise<TafsirCallResult> {
  const safeArgs = validateToolArgs(name, rawArgs);
  if (!session) throw new Error('Tafsir MCP منسلک نہیں — پہلے سے کنیکٹ کریں۔');

  const result = (await withTimeout(
    session.client.callTool({ name, arguments: safeArgs }),
    session.mode,
  )) as {
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: unknown;
  };

  const blocks = Array.isArray(result.content)
    ? result.content
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
    : [];
  const full = blocks.join('\n');
  const truncated = full.length > MAX_RESULT_CHARS;

  return {
    tool: name,
    text: truncated ? full.slice(0, MAX_RESULT_CHARS) : full,
    length: full.length,
    truncated,
    structured: result.structuredContent ?? undefined,
  };
}