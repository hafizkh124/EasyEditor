/**
 * M8 Layer 2 — the adapter contract (SPEC-M8 §3 "Layer 2", ADR-0017).
 *
 * Pure types only: this file is under shared/, imported by the Electron main
 * process (the adapters, the agent) and by the renderer (the P3 convert
 * dialog). No runtime-specific globals — see scripts/check-shared-purity.mjs.
 *
 * One adapter per external tool. Each declares which formats it reads/writes,
 * which operations it exposes, and whether it is present on this machine.
 * "Convert X to Y" is a path search over every adapter's read/write edges
 * (Layer 3), never a hand-written converter per pair.
 */

/** Document formats the bridge knows, as conversion-graph node names. */
export type DocFormat = 'docx' | 'pdf' | 'rtf' | 'html' | 'txt' | 'md' | 'inpage';

/** A single read or write capability an adapter contributes to the graph. */
export interface FormatEdge {
  format: DocFormat;
  /**
   * Quality weight for path-finding (higher = better). The planner prefers a
   * higher-total-quality path; e.g. Word's docx→pdf (0.95) beats a two-hop
   * route through rtf.
   */
  quality: number;
  /** What this edge is known to drop. Shown to the user before a conversion. */
  lossy?: string;
}

/** Named operations an adapter exposes beyond plain format conversion. */
export type AdapterOp =
  | 'toWord'
  | 'fromWord'
  | 'reflowPdf'
  | 'readStructure'
  | 'installFont';

/** What an adapter declares about itself (ADR-0017). */
export interface AdapterDescriptor {
  id: string;
  /** Human label, e.g. "Microsoft Word". */
  label: string;
  reads: FormatEdge[];
  writes: FormatEdge[];
  ops: AdapterOp[];
  /** Platforms the adapter can ever run on (COM ⇒ win32 only). */
  platforms: NodeJS.Platform[];
}

/** Present-on-this-machine result. `available:false` ⇒ the adapter is inert. */
export interface AdapterAvailability {
  available: boolean;
  version: string | null;
  /** Why it is unavailable, when it is. */
  reason?: string;
}

// ── readStructure output (docx → EasyEditor doc, inspection side) ──────────

export interface DocFootnote {
  /** 1-based index in reading order. */
  index: number;
  text: string;
}

export interface DocStructure {
  /** Heading text in document order (Word's own cross-reference list). */
  headings: string[];
  footnotes: DocFootnote[];
  /** Number of tracked revisions currently in the document. */
  trackedChanges: number;
  wordCount: number;
  /** 'rtl' | 'ltr' | 'mixed' — the document body's reading order. */
  readingOrder: 'rtl' | 'ltr' | 'mixed';
}

// ── conversion request/result ─────────────────────────────────────────────

export interface ConvertRequest {
  from: DocFormat;
  to: DocFormat;
  inputPath: string;
  outputPath: string;
}

export interface ConvertResult {
  outputPath: string;
  /** Every lossy edge the chosen path crossed — surfaced before/with the run. */
  losses: string[];
  ms: number;
}
