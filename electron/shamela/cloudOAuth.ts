/**
 * Cloud Shamela (شامله لنک) — the OAuth client provider + loopback callback
 * server (ADR-0044).
 *
 * Templates:
 *  - token storage: `electron/ai/keyStore.ts` (OS `safeStorage`, one `.enc`
 *    blob per item under `userData`, decrypted only in the main process).
 *  - the flow: `@modelcontextprotocol/sdk/.../examples/client/simpleOAuthClient*.js`
 *    (a one-shot `node:http` loopback server on 127.0.0.1, catch
 *    `UnauthorizedError` → `transport.finishAuth(code)` → reconnect).
 *
 * The custom `easyeditor://` scheme is deliberately NOT reused here — it is
 * blindly forwarded to the renderer for the Supabase sign-in and has no path
 * discrimination. A loopback redirect is self-contained and does the token
 * exchange in the main process.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { app, safeStorage, shell } from 'electron';
import { logger } from '../lib/logger.js';
import type { OAuthClientProvider, OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientMetadata,
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

const log = logger.child('shamela/cloudOAuth');

/** Loopback redirect (RFC 8252). Fixed ports; all three registered as redirect URIs. */
const LOOPBACK_HOST = '127.0.0.1';
export const LOOPBACK_PORTS = [43110, 43111, 43112] as const;
const CALLBACK_PATH = '/callback';
export const REDIRECT_URIS = LOOPBACK_PORTS.map((p) => `http://${LOOPBACK_HOST}:${p}${CALLBACK_PATH}`);
const FLOW_TIMEOUT_MS = 120_000;

const OK_HTML =
  '<!doctype html><meta charset="utf-8"><title>تم</title>' +
  '<body style="font-family:system-ui;text-align:center;padding:3rem" dir="rtl">' +
  '<h2>تم الاتصال</h2><p>يمكنك إغلاق هذه النافذة والعودة إلى EasyEditor.</p>' +
  '<script>setTimeout(()=>window.close(),1500)</script>';
const FAIL_HTML =
  '<!doctype html><meta charset="utf-8"><title>فشل</title>' +
  '<body style="font-family:system-ui;text-align:center;padding:3rem" dir="rtl">' +
  '<h2>تعذّر الاتصال</h2><p>أغلق هذه النافذة وحاول مرة أخرى من الإعدادات.</p>';

// ── encrypted blob helpers (keyStore.ts pattern, sync) ────────────────────

function blobPath(name: string): string {
  return path.join(app.getPath('userData'), `${name}.enc`);
}

function readBlob<T>(name: string): T | null {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const buf = fs.readFileSync(blobPath(name));
    const txt = safeStorage.decryptString(buf);
    return txt ? (JSON.parse(txt) as T) : null;
  } catch {
    return null;
  }
}

function writeBlob(name: string, value: unknown): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS safeStorage encryption is not available on this device — cannot store the شامله لنک session securely.');
  }
  fs.writeFileSync(blobPath(name), safeStorage.encryptString(JSON.stringify(value)));
}

function deleteBlob(name: string): void {
  try { fs.rmSync(blobPath(name)); } catch { /* not there */ }
}

const CLIENT_BLOB = 'shamela-cloud-client';
const TOKENS_BLOB = 'shamela-cloud-tokens';
const DISCOVERY_BLOB = 'shamela-cloud-discovery';

// ── the loopback server + pending flow ───────────────────────────────────

interface PendingFlow {
  codeVerifier?: string;
  state?: string;
  startedAt?: number;
  resolve?: (code: string) => void;
  reject?: (err: Error) => void;
  timer?: NodeJS.Timeout;
}
let pendingFlow: PendingFlow = {};
let loopbackServer: http.Server | null = null;
let boundPort: number | null = null;

/** Which loopback URL the current flow is using (matches one of REDIRECT_URIS). */
export function activeRedirectUri(): string {
  return `http://${LOOPBACK_HOST}:${boundPort ?? LOOPBACK_PORTS[0]}${CALLBACK_PATH}`;
}

function tryListen(port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(onCallback);
    srv.once('error', reject);
    srv.listen(port, LOOPBACK_HOST, () => { boundPort = port; resolve(srv); });
  });
}

async function startLoopbackServer(): Promise<void> {
  if (loopbackServer) return;
  let lastErr: unknown;
  for (const port of LOOPBACK_PORTS) {
    try { loopbackServer = await tryListen(port); return; }
    catch (e) { lastErr = e; }
  }
  throw new Error(`could not bind a loopback port (${LOOPBACK_PORTS.join(', ')}): ${(lastErr as Error)?.message ?? lastErr}`);
}

export function stopLoopbackServer(): void {
  try { loopbackServer?.close(); } catch { /* ignore */ }
  loopbackServer = null;
  boundPort = null;
}

function onCallback(req: http.IncomingMessage, res: http.ServerResponse): void {
  const u = new URL(req.url ?? '/', `http://${LOOPBACK_HOST}`);
  if (u.pathname !== CALLBACK_PATH) { res.writeHead(404); res.end(); return; }

  const code = u.searchParams.get('code');
  const state = u.searchParams.get('state');
  const err = u.searchParams.get('error');
  const send = (status: number, html: string): void => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  };

  if (err) {
    send(400, FAIL_HTML);
    pendingFlow.reject?.(new Error(`OAuth error from شامله لنک: ${err}`));
  } else if (pendingFlow.state && state !== pendingFlow.state) {
    send(400, FAIL_HTML);
    pendingFlow.reject?.(new Error('OAuth state mismatch — the flow was rejected.'));
  } else if (code) {
    send(200, OK_HTML);
    pendingFlow.resolve?.(code);
  } else {
    send(400, FAIL_HTML);
    pendingFlow.reject?.(new Error('OAuth callback had neither code nor error.'));
  }
  stopLoopbackServer();
}

/**
 * Resolves with the authorization code once the browser hits the loopback
 * callback, or rejects on error / timeout. `redirectToAuthorization` must have
 * already started the server + opened the browser.
 */
export function waitForLoopbackCode(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    pendingFlow.resolve = (code) => { clearTimeout(pendingFlow.timer); resolve(code); };
    pendingFlow.reject = (e) => { clearTimeout(pendingFlow.timer); reject(e); };
    pendingFlow.timer = setTimeout(() => {
      stopLoopbackServer();
      reject(new Error('OAuth timed out — no browser approval within 2 minutes.'));
    }, FLOW_TIMEOUT_MS);
  });
}

/** Whether an interactive flow is currently waiting on the browser. */
export function isFlowPending(): boolean {
  return Boolean(pendingFlow.resolve && loopbackServer);
}

/** Abort any in-flight flow (Cancel button, or app quitting). */
export function abortFlow(reason = 'cancelled'): void {
  pendingFlow.reject?.(new Error(`OAuth ${reason}`));
  pendingFlow = {};
  stopLoopbackServer();
}

// ── the provider ─────────────────────────────────────────────────────────

export class ShamelaCloudOAuthProvider implements OAuthClientProvider {
  get redirectUrl(): string {
    return activeRedirectUri();
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'EasyEditor (المكتبة الشاملة — سحابي)',
      client_uri: 'https://editor.alulama.org',
      redirect_uris: [...REDIRECT_URIS],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none', // public native client, PKCE only
    };
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return readBlob<OAuthClientInformationMixed>(CLIENT_BLOB) ?? undefined;
  }
  saveClientInformation(info: OAuthClientInformationMixed): void {
    writeBlob(CLIENT_BLOB, info);
  }

  tokens(): OAuthTokens | undefined {
    return readBlob<OAuthTokens>(TOKENS_BLOB) ?? undefined;
  }
  saveTokens(tokens: OAuthTokens): void {
    writeBlob(TOKENS_BLOB, tokens);
  }

  saveCodeVerifier(codeVerifier: string): void {
    pendingFlow.codeVerifier = codeVerifier;
  }
  codeVerifier(): string {
    if (!pendingFlow.codeVerifier) throw new Error('no PKCE code verifier for the current flow');
    return pendingFlow.codeVerifier;
  }

  state(): string {
    pendingFlow.state ??= crypto.randomUUID();
    return pendingFlow.state;
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (authorizationUrl.protocol !== 'https:') {
      throw new Error(`refusing to open a non-https authorization URL (${authorizationUrl.protocol})`);
    }
    await startLoopbackServer();
    log.info('opening شامله لنک authorization page in the browser');
    await shell.openExternal(authorizationUrl.toString());
    pendingFlow.startedAt = Date.now();
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    if (scope === 'all' || scope === 'tokens') deleteBlob(TOKENS_BLOB);
    if (scope === 'all' || scope === 'client') deleteBlob(CLIENT_BLOB);
    if (scope === 'all' || scope === 'discovery') deleteBlob(DISCOVERY_BLOB);
    if (scope === 'all' || scope === 'verifier') { pendingFlow.codeVerifier = undefined; pendingFlow.state = undefined; }
  }

  saveDiscoveryState(s: OAuthDiscoveryState): void {
    try { writeBlob(DISCOVERY_BLOB, s); } catch { /* cache only */ }
  }
  discoveryState(): OAuthDiscoveryState | undefined {
    return readBlob<OAuthDiscoveryState>(DISCOVERY_BLOB) ?? undefined;
  }
}

/** Does a saved account (client registration + tokens) exist on disk? */
export function hasSavedAccount(): boolean {
  return readBlob(TOKENS_BLOB) !== null;
}

/** Sync teardown for `before-quit`. */
export function terminateCloudSync(): void {
  abortFlow('app quitting');
}
