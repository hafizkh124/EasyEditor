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
 * dies — and P9 confirmed EXCEL.EXE / POWERPNT.EXE behave the same way. So
 * whenever the host starts an Office instance it *owns*, this module records
 * the PID plus its start time, and force-kills it on:
 *   - the host process crashing (WordHost 'exit' without a clean quit),
 *   - the Electron app quitting (`before-quit`, synchronous),
 *   - the next app launch, if a previous run left a record behind
 *     (`sweepStaleOnStartup`).
 *
 * The start-time fingerprint is the safety catch: a bare PID can be recycled
 * by the OS onto an unrelated process (even the user's own Word), and this
 * module must never kill an Office instance the user opened themselves. A kill
 * only proceeds when the PID is still live, still the SAME process name, AND
 * started at the exact time we recorded.
 */

/** The Office processes the host can own. */
export type OwnedProcName = 'WINWORD' | 'EXCEL' | 'POWERPNT';

interface OwnedProcRecord {
  name: OwnedProcName;
  pid: number;
  /** ISO start time, the fingerprint that guards against PID reuse. */
  startTime: string;
  /** When this record was written — purely for diagnostics. */
  recordedAt: string;
}

const RECORD_PATH = (): string =>
  path.join(app?.getPath ? app.getPath('userData') : process.cwd(), 'doc-bridge-host.json');

/** Owned processes, keyed by name (one instance of each app at most). */
const owned = new Map<OwnedProcName, OwnedProcRecord>();

// ── persistence ────────────────────────────────────────────────────────────

function persist(): void {
  try {
    if (owned.size === 0) {
      fs.rmSync(RECORD_PATH(), { force: true });
      return;
    }
    fs.writeFileSync(
      RECORD_PATH(),
      JSON.stringify({ owned: [...owned.values()] }, null, 2),
      'utf8',
    );
  } catch (err) {
    log.warn('could not persist owned-process record', { message: (err as Error).message });
  }
}

/** Read the persisted record, tolerating the pre-P9 single-Word format. */
function loadPersisted(): OwnedProcRecord[] {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(RECORD_PATH(), 'utf8'));
  } catch {
    return [];
  }
  const obj = raw as { owned?: unknown; pid?: unknown; startTime?: unknown; recordedAt?: unknown };
  if (Array.isArray(obj.owned)) {
    return (obj.owned as OwnedProcRecord[]).filter(
      (r) => r && typeof r.pid === 'number' && typeof r.name === 'string',
    );
  }
  // Legacy: { pid, startTime, recordedAt } — always a Word instance.
  if (typeof obj.pid === 'number') {
    return [{
      name: 'WINWORD',
      pid: obj.pid,
      startTime: String(obj.startTime ?? ''),
      recordedAt: String(obj.recordedAt ?? ''),
    }];
  }
  return [];
}

// ── start-time / identity lookup (Windows) ─────────────────────────────────

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

/** True if `pid` is currently a running process named `name` (e.g. WINWORD). */
function isProcess(name: OwnedProcName, pid: number): boolean {
  if (process.platform !== 'win32') return false;
  const r = spawnSync(
    'powershell',
    [
      '-NoProfile', '-NonInteractive', '-Command',
      `$p = Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue; ` +
      `if ($p -and $p.ProcessName -eq '${name}') { 'yes' }`,
    ],
    { windowsHide: true, timeout: 10_000, encoding: 'utf8' },
  );
  return (r.stdout || '').includes('yes');
}

// ── record lifecycle ───────────────────────────────────────────────────────

/**
 * Record an Office process this host started and owns. Persists to userData so
 * an app crash is recoverable next launch. No-op for pid <= 0.
 */
export function recordOwnedProcess(name: OwnedProcName, pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return;
  const startTime = getStartTime(pid) ?? new Date().toISOString();
  owned.set(name, { name, pid, startTime, recordedAt: new Date().toISOString() });
  persist();
  log.debug('recorded owned Office process', { name, pid, startTime });
}

/** Back-compat wrappers — the adapters call these by app. */
export function recordOwnedWord(pid: number): void { recordOwnedProcess('WINWORD', pid); }
export function recordOwnedExcel(pid: number): void { recordOwnedProcess('EXCEL', pid); }
export function recordOwnedPowerpoint(pid: number): void { recordOwnedProcess('POWERPNT', pid); }

/** Forget every owned process (called after a clean `quit`, which closes all). */
export function clearOwnedWord(): void {
  owned.clear();
  try { fs.rmSync(RECORD_PATH(), { force: true }); } catch { /* ignore */ }
}
export { clearOwnedWord as clearOwned };

function fingerprintMatches(rec: OwnedProcRecord): boolean {
  if (!isProcess(rec.name, rec.pid)) return false;
  const now = getStartTime(rec.pid);
  return now !== null && now === rec.startTime;
}

/** taskkill a pid asynchronously. */
function killAsync(pid: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const p = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    p.on('error', reject);
    p.on('exit', () => resolve());
  });
}

/**
 * Async kill of every owned Office process that is still alive and still ours.
 * Used when the host process crashed (unclean exit) — its Office instances are
 * now orphaned. A record that fails the fingerprint is discarded, never killed.
 */
export async function killOwnedWordIfAlive(): Promise<{ killed: boolean; reason: string }> {
  if (owned.size === 0) return { killed: false, reason: 'no owned process recorded' };
  const reasons: string[] = [];
  let killedAny = false;
  for (const rec of [...owned.values()]) {
    if (!fingerprintMatches(rec)) {
      reasons.push(`${rec.name} ${rec.pid}: pid gone or fingerprint no longer matches (not ours)`);
      owned.delete(rec.name);
      continue;
    }
    try {
      await killAsync(rec.pid);
      log.warn('killed orphaned Office process after host crash', { name: rec.name, pid: rec.pid });
      reasons.push(`killed ${rec.name} ${rec.pid}`);
      killedAny = true;
      owned.delete(rec.name);
    } catch (err) {
      log.error('failed to kill orphaned Office process', { name: rec.name, pid: rec.pid, message: (err as Error).message });
      reasons.push(`${rec.name} ${rec.pid}: ${(err as Error).message}`);
    }
  }
  persist();
  return { killed: killedAny, reason: reasons.join('; ') };
}

/**
 * Synchronous kill for the `before-quit` path (Electron does not await there).
 * Best-effort: verifies name + fingerprint synchronously, then taskkill.
 */
export function killOwnedWordSync(): void {
  if (owned.size === 0) return;
  for (const rec of [...owned.values()]) {
    try {
      if (!fingerprintMatches(rec)) continue;
      execFileSync('taskkill', ['/PID', String(rec.pid), '/T', '/F'], { windowsHide: true, timeout: 8_000 });
      log.warn('killed owned Office process on app quit', { name: rec.name, pid: rec.pid });
    } catch {
      /* process may already be gone, or taskkill unavailable — nothing else to do */
    }
  }
  clearOwnedWord();
}

/**
 * On app startup: if a previous run left an owned-process record and that exact
 * process (name + PID + start time) is still running, it is an orphan from a
 * hard app kill — clean it up. Anything that fails the fingerprint is left
 * alone (it is the user's own Office, or an unrelated process on a reused PID).
 */
export async function sweepStaleOnStartup(): Promise<void> {
  if (process.platform !== 'win32') return;
  const records = loadPersisted();
  if (records.length === 0) return;
  owned.clear();
  for (const rec of records) owned.set(rec.name, rec);
  for (const rec of records) {
    if (!fingerprintMatches(rec)) {
      log.debug('stale doc-bridge record found, but process is gone / not ours — discarding', { name: rec.name, pid: rec.pid });
      owned.delete(rec.name);
      continue;
    }
    log.warn('found orphaned Office process from a previous session — killing it', { name: rec.name, pid: rec.pid });
    try {
      await killAsync(rec.pid);
    } catch { /* best effort */ }
    owned.delete(rec.name);
  }
  persist();
}

/** Test/diagnostics accessor — the Word record specifically (pre-P9 shape). */
export function _currentRecord(): OwnedProcRecord | null {
  return owned.get('WINWORD') ?? null;
}

/** Test/diagnostics accessor — every owned record. */
export function _ownedRecords(): OwnedProcRecord[] {
  return [...owned.values()];
}
