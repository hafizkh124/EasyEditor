/**
 * electron/host/ — M8 Layer 1 (Process & session), SPEC-M8 §3.
 *
 * Shared types for the long-lived PowerShell/Word host. The op protocol is
 * the one the P0 spike proved (docs/adr/0015-m8-word-inpage-p0-spike.md);
 * P1 wires only `ping` / `detectTools` to the renderer, but the host script
 * carries the full proven set so P2's adapter has nothing new to add on the
 * PowerShell side.
 */

/** A command sent to wordBridge.ps1 — one JSON object per stdin line. */
export type HostCommand =
  | { op: 'ping' }
  | { op: 'detectWord' }
  | { op: 'open'; path: string }
  | { op: 'openPdfReflow'; path: string }
  | { op: 'setTrackRevisions'; enabled: boolean }
  | { op: 'setRtlPageSetup' }
  | { op: 'insertFootnote'; text: string }
  | { op: 'installFontCheck'; fontName: string }
  | { op: 'installFont'; path: string }
  | { op: 'save' }
  | { op: 'saveAs'; path: string }
  | { op: 'exportRtf'; path: string }
  | { op: 'wordPid' }
  | { op: 'close' }
  | { op: 'quit' };

export type HostOp = HostCommand['op'];

/** A reply line from wordBridge.ps1. `ok:false` carries `error`. */
export interface HostReply {
  ok: boolean;
  op?: HostOp;
  error?: string;
  [key: string]: unknown;
}

export interface WordPidReply extends HostReply {
  ok: true;
  op: 'wordPid';
  /** The WINWORD.EXE process id. */
  pid: number;
  /**
   * True only when this host is the one that started that WINWORD.EXE.
   * False when COM attached to a Word the user already had open — in which
   * case electron/host/process.ts must never kill it.
   */
  ownedByUs: boolean;
}

export interface DetectWordReply extends HostReply {
  ok: true;
  op: 'detectWord';
  installed: boolean;
  version?: string;
  build?: string | null;
}

/** Result of {@link detectTools}. */
export interface ToolAvailability {
  /** PowerShell itself is reachable (always true on a working Windows box). */
  powershell: boolean;
  /** Word COM automation works. */
  word: boolean;
  wordVersion: string | null;
  /** Platform is Windows — COM automation is Windows-only. */
  windows: boolean;
  /** A human-readable reason when `word` is false. */
  reason?: string;
}

/** Per-op timeout budget (ms). `openPdfReflow` is slow by nature — P0 saw ~23 s. */
export const OP_TIMEOUT_MS: Partial<Record<HostOp, number>> & { default: number } = {
  default: 20_000,
  ping: 5_000,
  detectWord: 30_000,
  openPdfReflow: 120_000,
  installFont: 15_000,
  quit: 8_000,
};

/** Structured error thrown by the host layer, so callers can branch on `code`. */
export class HostError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not-windows'
      | 'no-powershell'
      | 'word-unavailable'
      | 'host-crashed'
      | 'timeout'
      | 'op-failed'
      | 'bad-reply',
    readonly op?: HostOp,
  ) {
    super(message);
    this.name = 'HostError';
  }
}
