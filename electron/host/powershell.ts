import { app } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../lib/logger.js';
import {
  HostError,
  OP_TIMEOUT_MS,
  type HostCommand,
  type HostOp,
  type HostReply,
} from './types.js';

const log = logger.child('host/powershell');

/**
 * Resolves wordBridge.ps1 — packaged first, then the dev tree. Mirrors
 * shamelaNative.ts's getHelperJarPath(): on failure, say where it looked so a
 * packaging mistake is diagnosable from the message alone.
 */
export function resolveBridgeScript(): string {
  const appPath = app?.getAppPath ? app.getAppPath() : process.cwd();
  const packaged = Boolean(app?.isPackaged);
  // In a packaged build the .ps1 only exists under resources/bin (electron/ is
  // not in build.files). In dev the repo copy is the source of truth — prefer
  // it over any stale resources/bin/ staging left by an earlier `build:electron`.
  const candidates = packaged
    ? [
        path.join(process.resourcesPath || '', 'bin', 'wordBridge.ps1'),
        path.join(appPath, 'resources', 'bin', 'wordBridge.ps1'),
      ]
    : [
        path.join(appPath, 'electron', 'host', 'wordBridge.ps1'),
        path.join(process.resourcesPath || '', 'bin', 'wordBridge.ps1'),
      ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  throw new HostError(
    `wordBridge.ps1 نہیں ملا۔ تلاش کیے گئے راستے: ${candidates.filter(Boolean).join(' | ')}`,
    'host-crashed',
  );
}

interface Pending {
  op: HostOp;
  resolve: (r: HostReply) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * One long-lived PowerShell process running wordBridge.ps1. JSON command in on
 * stdin, one JSON reply line out on stdout, matched FIFO (the bridge is
 * strictly serial — it processes one line before reading the next).
 *
 * Events:
 *   'exit'  (code: number | null)  — the host process ended. Any WINWORD.EXE it
 *                                    started is now an orphan; the owner
 *                                    (docBridge facade + process.ts) must act.
 */
export class WordHost extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private rl: Interface | null = null;
  private readonly queue: Pending[] = [];
  private stopping = false;

  get pid(): number | undefined {
    return this.proc?.pid;
  }

  isAlive(): boolean {
    return this.proc !== null && this.proc.exitCode === null && !this.proc.killed;
  }

  /** Spawn the host. Throws HostError('not-windows') off Windows. */
  start(): void {
    if (process.platform !== 'win32') {
      throw new HostError('Word automation is Windows-only.', 'not-windows');
    }
    if (this.isAlive()) return;

    const script = resolveBridgeScript();
    this.stopping = false;

    const proc = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    this.proc = proc;

    this.rl = createInterface({ input: proc.stdout });
    this.rl.on('line', (line) => this.onLine(line));

    proc.stderr.on('data', (chunk: Buffer) => {
      log.warn('wordBridge stderr', { chunk: chunk.toString().trim().slice(0, 500) });
    });

    proc.on('error', (err) => {
      log.error('failed to spawn powershell host', { message: err.message });
      this.failAll(new HostError(`could not start PowerShell host: ${err.message}`, 'no-powershell'));
    });

    proc.on('exit', (code) => {
      const wasStopping = this.stopping;
      this.cleanup();
      this.failAll(
        new HostError(
          `wordBridge host exited (code ${code ?? 'null'})`,
          'host-crashed',
        ),
      );
      if (!wasStopping) log.error('wordBridge host exited unexpectedly', { code });
      this.emit('exit', code);
    });

    log.debug('wordBridge host started', { pid: proc.pid, script });
  }

  private onLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    const pending = this.queue.shift();
    if (!pending) {
      log.warn('wordBridge reply with no pending request', { line: trimmed.slice(0, 200) });
      return;
    }
    clearTimeout(pending.timer);
    let reply: HostReply;
    try {
      reply = JSON.parse(trimmed) as HostReply;
    } catch {
      pending.reject(new HostError(`bad reply from wordBridge: ${trimmed.slice(0, 200)}`, 'bad-reply', pending.op));
      return;
    }
    pending.resolve(reply);
  }

  /**
   * Send one command and await its reply. Rejects with HostError on timeout,
   * host crash, or a non-JSON reply. Does NOT reject on `{ok:false}` — that is
   * a valid protocol reply the caller inspects (send() vs sendOk()).
   */
  send<T extends HostReply = HostReply>(cmd: HostCommand): Promise<T> {
    if (!this.isAlive() || !this.proc) {
      return Promise.reject(new HostError('wordBridge host is not running', 'host-crashed', cmd.op));
    }
    const budget = OP_TIMEOUT_MS[cmd.op] ?? OP_TIMEOUT_MS.default;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Drop the pending slot so a late reply doesn't desync the FIFO.
        const idx = this.queue.findIndex((p) => p.timer === timer);
        if (idx !== -1) this.queue.splice(idx, 1);
        reject(new HostError(`timeout after ${budget}ms waiting for "${cmd.op}"`, 'timeout', cmd.op));
      }, budget);

      this.queue.push({
        op: cmd.op,
        resolve: (r) => resolve(r as T),
        reject,
        timer,
      });
      this.proc!.stdin.write(JSON.stringify(cmd) + '\n');
    });
  }

  /** Like send(), but rejects with HostError('op-failed') when `ok` is false. */
  async sendOk<T extends HostReply = HostReply>(cmd: HostCommand): Promise<T> {
    const reply = await this.send<T>(cmd);
    if (!reply.ok) {
      throw new HostError(reply.error || `"${cmd.op}" failed`, 'op-failed', cmd.op);
    }
    return reply;
  }

  /** Graceful shutdown: {op:"quit"} (closes Word cleanly), then ensure exit. */
  async stop(): Promise<void> {
    if (!this.isAlive() || !this.proc) {
      this.cleanup();
      return;
    }
    this.stopping = true;
    try {
      await this.send({ op: 'quit' });
    } catch {
      /* host may already be gone; fall through to kill */
    }
    // Give the process a beat to exit on its own after quitting Word.
    await new Promise<void>((res) => {
      const proc = this.proc;
      if (!proc || proc.exitCode !== null) return res();
      const t = setTimeout(() => {
        try { proc.kill(); } catch { /* already dead */ }
        res();
      }, 3000);
      proc.once('exit', () => { clearTimeout(t); res(); });
    });
    this.cleanup();
  }

  /** Hard kill of the PowerShell process. Does NOT touch WINWORD.EXE — that is
   *  process.ts's job, because only it knows whether Word was ownedByUs. */
  kill(): void {
    this.stopping = true;
    try { this.proc?.kill('SIGKILL'); } catch { /* already dead */ }
    this.cleanup();
  }

  private cleanup(): void {
    try { this.rl?.close(); } catch { /* ignore */ }
    this.rl = null;
    this.proc = null;
  }

  private failAll(err: Error): void {
    while (this.queue.length) {
      const p = this.queue.shift()!;
      clearTimeout(p.timer);
      p.reject(err);
    }
  }
}
