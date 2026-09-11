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
export type DocFormat =
  | 'docx' | 'pdf' | 'rtf' | 'html' | 'txt' | 'md' | 'inpage'
  // P9 — spreadsheet + presentation nodes (Excel / PowerPoint adapters).
  | 'xlsx' | 'csv' | 'pptx';

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
  | 'installFont'
  | 'applyCitations'
  // P9 — Word templates + application options.
  | 'installTemplate'
  | 'setGlobalOption'
  // P9 — Excel / PowerPoint inspection.
  | 'readSheet'
  | 'readOutline'
  | 'exportSpreadsheet'
  | 'exportPresentation'
  // M9 Phase 2 — new-chapter / comment / manuscript-compare / print / index.
  | 'createChapter'
  | 'addComment'
  | 'compareManuscripts'
  | 'setPrintLayout'
  | 'buildIndexes'
  // M11 Phase 4 — Excel write operations (ADR-0048).
  | 'createSpreadsheet'
  | 'writeRange'
  | 'setFormula'
  | 'formatCells'
  // M12 Phase D — multi-sheet build in one COM session (ADR-0050).
  | 'addSheet'
  | 'buildWorkbook';

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

// ── Excel: a sheet's used range (readSheet) ───────────────────────────────

export interface SheetData {
  /** Sheet name that was read. */
  sheet: string;
  /** All sheet names in the workbook, in tab order. */
  sheets: string[];
  /** Row-major cell values of the used range (strings; empty cells are ''). */
  rows: string[][];
  /** True when `rows` was capped and the sheet has more data below/right. */
  truncated: boolean;
}

// ── PowerPoint: the deck outline (readOutline) ────────────────────────────

export interface SlideOutline {
  /** 1-based slide number. */
  index: number;
  /** The slide's title placeholder text, or '' when it has none. */
  title: string;
  /** Body-text lines (bullets), in reading order. */
  bullets: string[];
}

export interface DeckStructure {
  slideCount: number;
  slides: SlideOutline[];
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
