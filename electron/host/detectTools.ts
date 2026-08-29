import { spawnSync } from 'node:child_process';
import { logger } from '../lib/logger.js';
import type { ToolAvailability } from './types.js';

const log = logger.child('host/detectTools');

function psVersion(): string | null {
  const r = spawnSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'],
    { windowsHide: true, timeout: 10_000, encoding: 'utf8' },
  );
  if (r.error || r.status !== 0) return null;
  const v = (r.stdout || '').trim();
  return v.length ? v : null;
}

/**
 * One-shot Word COM probe: create a throwaway Word.Application, read its
 * version, quit it. Nothing lingers — this is not the long-lived host.
 */
function wordVersion(): { installed: boolean; version: string | null; reason?: string } {
  const r = spawnSync(
    'powershell',
    [
      '-NoProfile', '-NonInteractive', '-Command',
      "try { $w = New-Object -ComObject Word.Application; $v = $w.Version; $w.Quit(); " +
      "[Console]::Out.WriteLine('OK ' + $v) } " +
      "catch { [Console]::Out.WriteLine('ERR ' + $_.Exception.Message) }",
    ],
    { windowsHide: true, timeout: 30_000, encoding: 'utf8' },
  );
  const out = (r.stdout || '').trim();
  if (out.startsWith('OK ')) return { installed: true, version: out.slice(3).trim() || null };
  const reason = out.startsWith('ERR ') ? out.slice(4).trim() : (r.error?.message || 'Word COM not available');
  return { installed: false, version: null, reason };
}

/**
 * What document-bridge capabilities this machine actually has. Called by the
 * `detectTools` IPC action; the renderer uses it to decide whether to offer
 * Word conversion at all. Word/COM is Windows-only.
 */
export function detectTools(): ToolAvailability {
  if (process.platform !== 'win32') {
    return {
      powershell: false,
      word: false,
      wordVersion: null,
      windows: false,
      reason: 'Word automation needs Windows.',
    };
  }

  const ps = psVersion();
  if (!ps) {
    return {
      powershell: false,
      word: false,
      wordVersion: null,
      windows: true,
      reason: 'PowerShell is not reachable on PATH.',
    };
  }

  const word = wordVersion();
  log.debug('tool detection', { powershell: ps, word: word.installed, wordVersion: word.version });
  return {
    powershell: true,
    windows: true,
    word: word.installed,
    wordVersion: word.version,
    ...(word.installed ? {} : { reason: `Microsoft Word not available: ${word.reason}` }),
  };
}
