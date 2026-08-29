import { app } from 'electron';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../lib/logger.js';

const log = logger.child('host/process');

/**
 * M8 Layer 1 — orphan-process guard (SPEC-M8 §6 constraint 1 / P0 proof 6).
 *
 * Proof 6 confirmed: WINWORD.EXE does NOT exit when the process automating it
 * dies. So whenever the host starts a Word instance it *owns*, this module
 * records the PID plus its start time, and force-kills it on:
 *   - the host process crashing (WordHost 'exit' without a clean quit),
 *   - the Electron app quitting (`before-quit`, synchronous),
 *   - the next app launch, if a previous run left a record behind
 *     (`sweepStaleOnStartup`).
 *
 * The start-time fingerprint is the safety catch: a bare PID can be recycled
 * by the OS onto an unrelated process (even the user's own Word), and this
 * module must never kill a Word the user opened themselves. A kill only
 * proceeds when the PID is still live, still WINWORD.EXE, AND started at the
 * exact time we recorded.
 */

interface OwnedWordRecord {
  pid: number;
  /** ISO start time, the fingerprint that guards against PID reuse. */
  startTime: string;
  /** When this record was written — purely for diagnostics. */
  recordedAt: string;
}

const RECORD_PATH = (): string =>
  path.join(app?.getPath ? app.getPath('userData') : process.cwd(), 'doc-bridge-host.json');

let current: OwnedWordRecord | null = null;

// ── start-time lookup (Windows) ────────────────────────────────────────────

/** ISO start time of a PID, or null if it isn't running / isn't queryable. */
function getStartTime(pid: number): string | null {
  if (process.platform !== 'win32') return null;
  const r = spawnSync(
    'powershell',
    [
      '-NoProfile', '-NonInteractive', '-Command',
      `$p = Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue; ` +
      `if ($p) { $p.StartTime.ToString('o') }`,
    ],
    { windowsHide: true, timeout: 10_000, encoding: 'utf8' },
  );
  const out = (r.stdout || '').trim();
  return out.length ? out : null;
}

/** True if `pid` is currently a running WINWORD.EXE. */
function isWinword(pid: number): boolean {
  if (process.platform !== 'win32') return false;
  const r = spawnSync(
    'powershell',
    [
      '-NoProfile', '-NonInteractive', '-Command',
      `$p = Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue; ` +
      `if ($p -and $p.ProcessName -eq 'WINWORD') { 'yes' }`,
    ],
    { windowsHide: true, timeout: 10_000, encoding: 'utf8' },
  );
  return (r.stdout || '').includes('yes');
}

// ── record lifecycle ───────────────────────────────────────────────────────

/**
 * Record a WINWORD.EXE this host started and owns. Persists to userData so an
 * app crash is recoverable next launch. No-op for pid <= 0.
 */
export function recordOwnedWord(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return;
  const startTime = getStartTime(pid) ?? new Date().toISOString();
  current = { pid, startTime, recordedAt: new Date().toISOString() };
  try {
    fs.writeFileSync(RECORD_PATH(), JSON.stringify(current, null, 2), 'utf8');
  } catch (err) {
    log.warn('could not persist owned-Word record', { message: (err as Error).message });
  }
  log.debug('recorded owned WINWORD.EXE', { pid, startTime });
}

/** Forget the current owned Word (called after a clean quit). */
export function clearOwnedWord(): void {
  current = null;
  try {
    fs.rmSync(RECORD_PATH(), { force: true });
  } catch {
    /* ignore */
  }
}

function fingerprintMatches(rec: OwnedWordRecord): boolean {
  if (!isWinword(rec.pid)) return false;
  const now = getStartTime(rec.pid);
  return now !== null && now === rec.startTime;
}

/**
 * Async kill of the currently-owned Word if it is still alive and still ours.
 * Used when the host process crashed (unclean exit) — Word is now orphaned.
 */
export async function killOwnedWordIfAlive(): Promise<{ killed: boolean; reason: string }> {
  const rec = current;
  if (!rec) return { killed: false, reason: 'no owned Word recorded' };
  if (!fingerprintMatches(rec)) {
    clearOwnedWord();
    return { killed: false, reason: 'pid gone or fingerprint no longer matches (not ours)' };
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const p = spawn('taskkill', ['/PID', String(rec.pid), '/T', '/F'], { windowsHide: true });
      p.on('error', reject);
      p.on('exit', () => resolve());
    });
    log.warn('killed orphaned WINWORD.EXE after host crash', { pid: rec.pid });
    clearOwnedWord();
    return { killed: true, reason: `killed pid ${rec.pid}` };
  } catch (err) {
    log.error('failed to kill orphaned WINWORD.EXE', { pid: rec.pid, message: (err as Error).message });
    return { killed: false, reason: (err as Error).message };
  }
}

/**
 * Synchronous kill for the `before-quit` path (Electron does not await there).
 * Best-effort: verifies WINWORD + fingerprint synchronously, then taskkill.
 */
export function killOwnedWordSync(): void {
  const rec = current;
  if (!rec) return;
  try {
    if (!fingerprintMatches(rec)) {
      clearOwnedWord();
      return;
    }
    execFileSync('taskkill', ['/PID', String(rec.pid), '/T', '/F'], { windowsHide: true, timeout: 8_000 });
    log.warn('killed owned WINWORD.EXE on app quit', { pid: rec.pid });
  } catch {
    /* process may already be gone, or taskkill unavailable — nothing else to do */
  }
  clearOwnedWord();
}

/**
 * On app startup: if a previous run left an owned-Word record and that exact
 * process (PID + start time) is still a running WINWORD.EXE, it is an orphan
 * from a hard app kill — clean it up. Anything that fails the fingerprint is
 * left alone (it is the user's own Word, or an unrelated process on a reused
 * PID).
 */
export async function sweepStaleOnStartup(): Promise<void> {
  if (process.platform !== 'win32') return;
  let rec: OwnedWordRecord;
  try {
    const raw = fs.readFileSync(RECORD_PATH(), 'utf8');
    rec = JSON.parse(raw) as OwnedWordRecord;
  } catch {
    return; // no record — normal case
  }
  current = rec;
  if (!fingerprintMatches(rec)) {
    log.debug('stale doc-bridge record found, but process is gone / not ours — discarding', { pid: rec.pid });
    clearOwnedWord();
    return;
  }
  log.warn('found orphaned WINWORD.EXE from a previous session — killing it', { pid: rec.pid });
  await killOwnedWordIfAlive();
}

/** Test/diagnostics accessor. */
export function _currentRecord(): OwnedWordRecord | null {
  return current;
}
