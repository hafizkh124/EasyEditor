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
  | { op: 'applyCitations'; footnotes: Array<{ marker: string; text: string }>; stripMarkers?: boolean }
  | { op: 'installFontCheck'; fontName: string }
  | { op: 'installFont'; path: string }
  // ── P9: templates + global options ────────────────────────────────────
  | { op: 'installTemplate'; path: string }
  | { op: 'attachTemplate'; path: string }
  | { op: 'getGlobalOption'; name: string }
  | { op: 'setGlobalOption'; name: string; value: string }
  | { op: 'readStructure' }
  | { op: 'save' }
  | { op: 'saveAs'; path: string }
  | { op: 'exportAs'; path: string; format: 'docx' | 'pdf' | 'rtf' | 'html' | 'txt' }
  | { op: 'wordPid' }
  | { op: 'close' }
  | { op: 'quit' }
  // ── P9: Excel ──────────────────────────────────────────────────────────
  | { op: 'excelOpen'; path: string }
  | { op: 'excelExport'; path: string; format: 'xlsx' | 'csv' | 'pdf' }
  | { op: 'excelReadSheet'; sheet?: string; maxRows?: number; maxCols?: number }
  | { op: 'excelPid' }
  | { op: 'excelClose' }
  // ── P9: PowerPoint ────────────────────────────────────────────────────
  | { op: 'pptOpen'; path: string }
  | { op: 'pptExport'; path: string; format: 'pptx' | 'pdf' }
  | { op: 'pptReadOutline' }
  | { op: 'pptPid' }
  | { op: 'pptClose' };

export type HostOp = HostCommand['op'];

/** A reply line from wordBridge.ps1. `ok:false` carries `error`. */
export interface HostReply {
  ok: boolean;
  op?: HostOp;
  error?: string;
  [key: string]: unknown;
}

/**
 * The reply to any `*Pid` op. `ownedByUs` is true only when this host started
 * that process; false when COM attached to one the user already had open, in
 * which case electron/host/process.ts must never kill it.
 */
export interface OwnedPidReply extends HostReply {
  ok: true;
  pid: number;
  ownedByUs: boolean;
}

export interface WordPidReply extends OwnedPidReply {
  op: 'wordPid';
}

export interface DetectWordReply extends HostReply {
  ok: true;
  op: 'detectWord';
  installed: boolean;
  version?: string;
  build?: string | null;
}

export interface ReadStructureReply extends HostReply {
  ok: true;
  op: 'readStructure';
  headings: string[];
  footnotes: Array<{ index: number; text: string }>;
  trackedChanges: number;
  wordCount: number;
  readingOrder: 'rtl' | 'ltr' | 'mixed';
}

export interface InstallFontReply extends HostReply {
  ok: true;
  op: 'installFont';
  fontName: string;
  facesRegistered: number;
  verifiedInRunningWord: boolean;
}

export interface ApplyCitationsReply extends HostReply {
  ok: true;
  op: 'applyCitations';
  /** How many footnotes were inserted (marker occurrences × markers). */
  applied: number;
  /** Markers that were not found anywhere in the document. */
  notFound: string[];
  footnoteCount: number;
}

export interface InstallTemplateReply extends HostReply {
  ok: true;
  op: 'installTemplate';
  templateName: string;
  dest: string;
}

export interface GlobalOptionReply extends HostReply {
  ok: true;
  op: 'getGlobalOption' | 'setGlobalOption';
  name: string;
  /** 'true' | 'false'. */
  value: string;
}

export interface ExcelOpenReply extends HostReply {
  ok: true;
  op: 'excelOpen';
  name: string;
  sheets: string[];
}

export interface ExcelReadSheetReply extends HostReply {
  ok: true;
  op: 'excelReadSheet';
  sheet: string;
  sheets: string[];
  rows: string[][];
  truncated: boolean;
}

export interface PptOpenReply extends HostReply {
  ok: true;
  op: 'pptOpen';
  name: string;
  slideCount: number;
}

export interface PptOutlineReply extends HostReply {
  ok: true;
  op: 'pptReadOutline';
  slideCount: number;
  slides: Array<{ index: number; title: string; bullets: string[] }>;
}

/** Result of {@link detectTools}. */
export interface ToolAvailability {
  /** PowerShell itself is reachable (always true on a working Windows box). */
  powershell: boolean;
  /** Word COM automation works. */
  word: boolean;
  wordVersion: string | null;
  /** Excel COM automation works (P9). */
  excel?: boolean;
  excelVersion?: string | null;
  /** PowerPoint COM automation works (P9). */
  powerpoint?: boolean;
  powerpointVersion?: string | null;
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
  open: 60_000,
  openPdfReflow: 120_000,
  readStructure: 60_000,
  applyCitations: 120_000,
  exportAs: 120_000,
  saveAs: 60_000,
  installFont: 15_000,
  installTemplate: 15_000,
  attachTemplate: 30_000,
  quit: 8_000,
  // P9 — Office launch + fixed-format export are as slow as Word's.
  excelOpen: 60_000,
  excelExport: 120_000,
  excelReadSheet: 60_000,
  pptOpen: 60_000,
  pptExport: 120_000,
  pptReadOutline: 60_000,
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
