/**
 * electron/host/ — M8 Layer 1 public facade (SPEC-M8 §3).
 *
 * Owns the single long-lived {@link WordHost} and keeps it wired to the
 * orphan-process guard in ./process.ts. P1 exposes only `detectTools` and
 * `ping` to the renderer (see electron/ipc/docBridgeHandlers.ts); the Word
 * adapter ops land in P2 on top of this same host.
 */

import { logger } from '../lib/logger.js';
import { WordHost } from './powershell.js';
import { detectTools } from './detectTools.js';
import {
  recordOwnedWord,
  recordOwnedExcel,
  recordOwnedPowerpoint,
  clearOwnedWord,
  killOwnedWordIfAlive,
  killOwnedWordSync,
  sweepStaleOnStartup,
} from './process.js';
import { HostError, type OwnedPidReply } from './types.js';

const log = logger.child('host');

export { detectTools };
export { WordHost } from './powershell.js';
export * from './types.js';

let host: WordHost | null = null;

// The host is line-serial, but a document operation is a *sequence* of ops
// (open → … → saveAs → close) against the single `$script:doc`. Two sequences
// interleaving would corrupt that state, so every adapter document session
// runs through this mutex. It also matches SPEC-M8's "only one agent task at
// a time" rule for COM re-entrancy — extended here to plain menu conversions.
let chain: Promise<unknown> = Promise.resolve();

export function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  // Keep the chain going even if fn rejects, but don't let it hold the error.
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * The shared host, started on first use. On an unexpected exit (crash) it
 * force-kills any WINWORD.EXE it owned — that is exactly the orphan P0 proof 6
 * caught — and drops the reference so the next call starts a fresh one.
 */
export function getWordHost(): WordHost {
  if (host && host.isAlive()) return host;

  const h = new WordHost();
  h.on('exit', (code: number | null) => {
    void killOwnedWordIfAlive().then((r) => {
      if (r.killed) log.warn('orphan cleanup after host exit', { code, ...r });
    });
    if (host === h) host = null;
  });
  h.start();
  host = h;
  return h;
}

/**
 * After any op that may have started Word, capture which WINWORD.EXE we own so
 * process.ts can clean it up later. Safe to call repeatedly.
 */
export async function refreshOwnedWord(): Promise<void> {
  await refreshOwned({ op: 'wordPid' }, recordOwnedWord);
}

/** P9 — the Excel / PowerPoint equivalents. */
export async function refreshOwnedExcel(): Promise<void> {
  await refreshOwned({ op: 'excelPid' }, recordOwnedExcel);
}
export async function refreshOwnedPowerpoint(): Promise<void> {
  await refreshOwned({ op: 'pptPid' }, recordOwnedPowerpoint);
}

async function refreshOwned(
  cmd: { op: 'wordPid' } | { op: 'excelPid' } | { op: 'pptPid' },
  record: (pid: number) => void,
): Promise<void> {
  if (!host || !host.isAlive()) return;
  try {
    const reply = await host.send<OwnedPidReply>(cmd);
    if (reply.ok && reply.ownedByUs && typeof reply.pid === 'number') {
      record(reply.pid);
    }
  } catch (err) {
    // The app was not started, or nothing is open — nothing to own.
    log.debug('refreshOwned: nothing to record', { op: cmd.op, message: (err as Error).message });
  }
}

/** Start the host if needed and round-trip a ping. Returns latency in ms. */
export async function pingHost(): Promise<{ ok: boolean; latencyMs: number | null; error?: string }> {
  const started = Date.now();
  try {
    const h = getWordHost();
    const reply = await h.send({ op: 'ping' });
    if (!reply.ok || reply.pong !== true) {
      return { ok: false, latencyMs: null, error: reply.error || 'unexpected ping reply' };
    }
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    const message = err instanceof HostError ? err.message : String(err);
    return { ok: false, latencyMs: null, error: message };
  }
}

/** App-startup hook: clean up an orphan a previous hard-killed run left behind. */
export async function initDocBridge(): Promise<void> {
  await sweepStaleOnStartup();
}

/** Graceful shutdown: quit Word cleanly through the host, then forget it. */
export async function shutdownDocBridge(): Promise<void> {
  if (host) {
    await host.stop();
    host = null;
  }
  clearOwnedWord();
}

/**
 * Synchronous shutdown for `before-quit` (Electron does not await there):
 * hard-kill the owned WINWORD.EXE, then the host process. Mirrors
 * tafsir/mcpClient.ts's terminateLocalSync().
 */
export function shutdownDocBridgeSync(): void {
  killOwnedWordSync();
  try { host?.kill(); } catch { /* already gone */ }
  host = null;
}
