/**
 * Cloud Shamela (شامله لنک) — the MCP client (ADR-0044).
 *
 * Mirrors `electron/tafsir/mcpClient.ts` (module-singleton session, timeouts,
 * allowlisted `callTool`) but over an OAuth transport: a 401 on the first
 * `initialize` makes the SDK run `auth()`, which (via our provider) opens the
 * browser + the loopback server and throws `UnauthorizedError`; we then wait
 * for the loopback code, `transport.finishAuth(code)`, and reconnect.
 *
 * All tool names / result shapes are PROVISIONAL — see `cloudAllowlist.ts`.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { createHash } from 'node:crypto';
import { logger } from '../lib/logger.js';
import type { HealthResult } from '../../shared/connectors/health.js';
import type { ShamelaSearchResult, ShamelaPageContent } from './shamelaNative.js';
import {
  CLOUD_ENDPOINT,
  MAX_RESULT_CHARS,
  validateCloudToolArgs,
  SHAMELA_CLOUD_TOOL_ALLOWLIST,
} from './cloudAllowlist.js';
import {
  ShamelaCloudOAuthProvider,
  waitForLoopbackCode,
  stopLoopbackServer,
  hasSavedAccount,
  isFlowPending,
  abortFlow,
} from './cloudOAuth.js';

const log = logger.child('shamela/cloudClient');

const CONNECT_TIMEOUT_MS = 30_000; // OAuth discovery + DCR can be slow first time
const CALL_TIMEOUT_MS = 30_000;

export interface CloudBook {
  id: number;
  title: string;
  author: string | null;
  deathYear: number | null;
}

export interface CloudStatus {
  connected: boolean;
  hasAccount: boolean;
  flowPending: boolean;
}

interface CloudSession {
  client: Client;
  transport: StreamableHTTPClientTransport;
}

let session: CloudSession | null = null;
let provider: ShamelaCloudOAuthProvider | null = null;
let connecting: Promise<void> | null = null;

function getProvider(): ShamelaCloudOAuthProvider {
  provider ??= new ShamelaCloudOAuthProvider();
  return provider;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`شامله لنک: ${label} timed out`)), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

function newTransport(): { client: Client; transport: StreamableHTTPClientTransport } {
  const client = new Client({ name: 'easy-editor-shamela-cloud', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(CLOUD_ENDPOINT), { authProvider: getProvider() });
  return { client, transport };
}

async function safeClose(t: { close(): Promise<void> }): Promise<void> {
  try { await t.close(); } catch { /* ignore */ }
}

/**
 * Connect, running the interactive OAuth dance if the first attempt throws
 * `UnauthorizedError`. De-dupes concurrent callers.
 */
export async function connectCloud(): Promise<void> {
  if (session) return;
  if (connecting) return connecting;
  connecting = (async () => {
    const first = newTransport();
    try {
      await withTimeout(first.client.connect(first.transport), CONNECT_TIMEOUT_MS, 'connect');
      session = first;
      return;
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) {
        await safeClose(first.transport);
        throw err;
      }
      log.info('شامله لنک needs authorization — waiting for the browser callback');
      // provider.redirectToAuthorization already opened the browser + loopback.
      let code: string;
      try {
        code = await waitForLoopbackCode();
      } catch (e) {
        await safeClose(first.transport);
        throw e;
      }
      await first.transport.finishAuth(code); // token exchange + saveTokens
      await safeClose(first.transport);
      stopLoopbackServer();

      const second = newTransport();
      await withTimeout(second.client.connect(second.transport), CONNECT_TIMEOUT_MS, 'reconnect');
      session = second;
    }
  })().finally(() => { connecting = null; });
  return connecting;
}

export async function disconnectCloud(): Promise<void> {
  const s = session;
  session = null;
  if (s) { await safeClose(s.client); await safeClose(s.transport); }
}

export async function signOutCloud(): Promise<void> {
  await disconnectCloud();
  getProvider().invalidateCredentials('all');
}

export function terminateCloudClientSync(): void {
  abortFlow('app quitting');
  session = null;
}

export function cloudStatus(): CloudStatus {
  return { connected: session !== null, hasAccount: hasSavedAccount(), flowPending: isFlowPending() };
}

export async function listCloudToolsRaw(): Promise<Array<{ name: string; description?: string }>> {
  await connectCloud();
  const r = await withTimeout(session!.client.listTools(), CALL_TIMEOUT_MS, 'listTools');
  return r.tools.map((t) => ({ name: t.name, description: t.description }));
}

/** Health probe — NEVER starts an interactive flow. */
export async function pingCloud(): Promise<HealthResult> {
  if (!hasSavedAccount()) {
    return { ok: false, detail: 'حساب متصل نہیں — Connect your شامله لنک account in Settings' };
  }
  if (!session) {
    try { await connectCloud(); }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e), detail: 'reconnect your account' }; }
  }
  const started = Date.now();
  try {
    await withTimeout(session!.client.ping(), 10_000, 'ping');
    return { ok: true, latencyMs: Date.now() - started };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── tool calls + normalisers (PROVISIONAL shapes) ────────────────────────

interface CloudCallResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
}

async function callCloud(name: string, rawArgs: unknown): Promise<CloudCallResult> {
  await connectCloud();
  const safe = validateCloudToolArgs(name, rawArgs);
  try {
    return (await withTimeout(session!.client.callTool({ name, arguments: safe }), CALL_TIMEOUT_MS, name)) as CloudCallResult;
  } catch (err) {
    // A mid-run 401 the SDK could not refresh away → clean message, NO browser pop.
    if (err instanceof UnauthorizedError) {
      await disconnectCloud();
      throw new Error('شامله لنک: انتهت الجلسة — أعد الربط من الإعدادات');
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (/\b429\b|rate|quota|Retry-After/i.test(msg)) {
      throw new Error('شامله لنک: تجاوزت الحصة — أعد المحاولة بعد قليل');
    }
    throw err;
  }
}

function resultText(r: CloudCallResult): string {
  const blocks = Array.isArray(r.content)
    ? r.content.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text as string)
    : [];
  return blocks.join('\n').slice(0, MAX_RESULT_CHARS);
}

function asRows(r: CloudCallResult): Record<string, unknown>[] {
  const sc = r.structuredContent as Record<string, unknown> | undefined;
  const candidate =
    (sc && (sc.results ?? sc.pages ?? sc.hits ?? sc.books ?? sc.authors ?? sc.items)) ??
    (Array.isArray(sc) ? sc : undefined);
  return Array.isArray(candidate) ? (candidate as Record<string, unknown>[]) : [];
}

const numOf = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};
const strOf = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

export async function searchCloud(query: string, limit = 8): Promise<ShamelaSearchResult[]> {
  const r = await callCloud('shamela_search_pages', { query, limit: Math.min(Math.max(limit, 1), 15) });
  const rows = asRows(r);
  if (rows.length === 0) {
    const text = resultText(r).trim();
    if (!text) return [];
    // No structured rows — one bibliographic-ish chunk so a citation is still possible.
    return [{
      bookId: `h${createHash('sha1').update(text.slice(0, 200)).digest('hex').slice(0, 10)}`,
      bookTitle: 'شامله لنک',
      pageNumber: 0,
      snippet: text.slice(0, 600),
      score: 0,
    }];
  }
  return rows.slice(0, limit).map((row) => ({
    bookId: strOf(row.book_id ?? row.bookId ?? row.id) || '0',
    bookTitle: strOf(row.book_name ?? row.bookTitle ?? row.title),
    pageNumber: numOf(row.page ?? row.pageNumber ?? row.page_number),
    snippet: strOf(row.content ?? row.snippet ?? row.highlighted ?? row.text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    score: numOf(row.score),
  }));
}

export async function readCloudPage(bookId: string, page: number): Promise<ShamelaPageContent> {
  const r = await callCloud('shamela_get_page', { book_id: numOf(bookId), page: numOf(page) });
  const rows = asRows(r);
  const row = (rows[0] ?? (r.structuredContent as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
  return {
    bookId,
    pageNumber: numOf(row.page ?? row.pageNumber ?? page) || page,
    text: strOf(row.text ?? row.content ?? row.body).replace(/<[^>]+>/g, ' ') || resultText(r),
    footnotes: strOf(row.footnotes ?? row.foot) || undefined,
  };
}

export async function findCloudBook(query: string): Promise<CloudBook[]> {
  const r = await callCloud('shamela_search_books', { query, limit: 15 });
  return asRows(r).slice(0, 15).map((row) => ({
    id: numOf(row.id ?? row.book_id ?? row.bookId),
    title: strOf(row.title ?? row.book_name ?? row.name),
    author: strOf(row.author ?? row.author_name) || null,
    deathYear: row.deathYear != null || row.death_year != null ? numOf(row.deathYear ?? row.death_year) : null,
  }));
}

/** Exported for tests — the provisional tool list must never be empty. */
export const _CLOUD_TOOL_NAMES = SHAMELA_CLOUD_TOOL_ALLOWLIST.map((t) => t.name);
