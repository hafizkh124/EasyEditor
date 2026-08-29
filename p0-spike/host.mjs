// host.mjs — M7 P0 spike: minimal stand-in for the planned
// electron/host/powershell.ts (تہہ ۱). Spawns ONE long-lived PowerShell
// process running word-bridge.ps1, sends it JSON commands over stdin, and
// resolves a promise per command from its stdout (newline-delimited JSON).
//
// This is throwaway spike code, not production electron/host code — its
// only job is to prove the pattern (one process, JSON in/out, no shell
// string concatenation) actually works before that real file is written.
//
// Security note, same as the real plan: every command below is built as a
// JSON object and serialized with JSON.stringify — never string-interpolated
// into a shell command. Nothing from a model or user goes through `exec`.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export class WordBridge {
  constructor(scriptPath) {
    this.proc = spawn('powershell', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    this.queue = [];
    this.rl = createInterface({ input: this.proc.stdout });
    this.rl.on('line', (line) => {
      const pending = this.queue.shift();
      if (!pending) return;
      try {
        pending.resolve(JSON.parse(line));
      } catch (e) {
        pending.reject(new Error(`bad JSON from word-bridge: ${line}`));
      }
    });

    this.proc.stderr.on('data', (chunk) => {
      process.stderr.write(`[word-bridge stderr] ${chunk}`);
    });

    this.proc.on('exit', (code) => {
      while (this.queue.length) {
        this.queue.shift().reject(new Error(`word-bridge exited (code ${code}) before responding`));
      }
    });
  }

  /** Send one command, wait for its matching JSON reply line. */
  send(command, timeoutMs = 20_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`timeout waiting for reply to ${JSON.stringify(command)}`));
      }, timeoutMs);
      this.queue.push({
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.proc.stdin.write(JSON.stringify(command) + '\n');
    });
  }

  /** Kill the PowerShell host itself WITHOUT sending {op:"quit"} first —
   *  simulates a crash/force-close, for the orphan-process test. */
  killWithoutCleanup() {
    this.proc.kill('SIGKILL');
  }

  dispose() {
    try { this.proc.kill(); } catch { /* already dead */ }
    this.rl.close();
  }
}
