/**
 * JKHSSN engine — payload types shared across the IPC boundary and the renderer
 * visualisations. Pure.
 *
 * "jk_*_id" fields are جوامع الكلم's own numeric ids, kept so a follow-up query
 * (drill into a chain, open a narrator) is a plain integer lookup. Display names
 * and verbatim matn are NOT in these payloads — they carry ids and the readable
 * plain-text apparatus (verdicts, rulings, ranks, dates); the renderer resolves
 * names/matn from Supabase (`resolveNames.ts`, ADR-0045).
 */

// ── detection ────────────────────────────────────────────────────────────────

export interface JkhssnStatus {
  installed: boolean;
  /** Absolute path to `…/Data/HadithDB`, or null. */
  dataPath: string | null;
  /** `Catalog.xml` found and readable. */
  catalogFound: boolean;
  /** Absolute path to the built `jkhssn.sqlite`, or null when never built. */
  indexPath: string | null;
  indexBuilt: boolean;
  /** Built, but from a different source path or an older schema version. */
  indexStale: boolean;
  /** Per-table row counts recorded in `meta` when the index was built. */
  rowCounts?: Record<string, number>;
  /** Urdu, user-facing — why it is not connected. */
  reason?: string;
}

export interface JkhssnDiagnostics {
  dataPathChecked: string | null;
  catalogFound: boolean;
  readableTables: number;
  indexBuilt: boolean;
  indexFresh: boolean;
  indexSchemaVersion: number | null;
  builtSchemaVersion: number;
  /** Urdu strings, shown as a checklist. */
  errors: string[];
}

export interface JkhssnIndexProgress {
  phase: 'read' | 'write' | 'fts' | 'done';
  table: string;
  done: number;
  total: number;
}

// ── axis payloads ────────────────────────────────────────────────────────────

export interface SanadTreeNode {
  id: number;
  parentId: number | null;
  jkRawyId: number | null;
  isLeaf: boolean;
  isMarfoa: boolean;
  isMawkof: boolean;
  isMaktoa: boolean;
}

export interface SanadTreePayload {
  chains: Array<{ chainId: number; bookId: number | null; sanadType: number | null; nodes: SanadTreeNode[] }>;
  /** Every distinct narrator id in the payload — hand to `resolveNarratorNames`. */
  rawyIds: number[];
}

export interface JarhEntry {
  /** The verdict phrase (NounsGarh.Text — plain). */
  verdict: string;
  /** The critic's own words, when linked (NounsScientistsSays.Say — plain). */
  criticSay: string | null;
  criticId: number | null;
}

export interface NarratorCardPayload {
  jkRawyId: number | null;
  /** Readable name forms from NounsForms.RawyTextShape, most frequent first. */
  nameShapes: string[];
  deathYearNum: number | null;
  tabaqaNum: number | null;
  hadithsCount: number | null;
  /** Plain-text labels straight from جوامع الكلم (التقريب formula, city names…). */
  tabaqa: string | null;
  birthYear: string | null;
  deathYear: string | null;
  martabaIbnHajar: string | null;
  martabaZahabi: string | null;
  birthCity: string | null;
  deathCity: string | null;
  livingCity: string | null;
  mazhab: string | null;
  jarh: JarhEntry[];
  teachers: Array<{ id: number; hadithsCount: number | null }>;
  students: Array<{ id: number; hadithsCount: number | null }>;
  /** Ids whose names the renderer must resolve from Supabase. */
  needsNames: number[];
}

export interface TakhrijEntry {
  hadithMainId: number;
  groupId: number | null;
  compoundMatnId: number | null;
  pivotId: number | null;
  matnLength: number | null;
  isStory: boolean;
  bookId: number | null;
}

export interface TakhrijPayload {
  entries: TakhrijEntry[];
  pivotIds: number[];
  bookIds: number[];
  serviceState: { degree: number | null; flags: Record<string, boolean> } | null;
}

export interface MatnComparePayload {
  groupId: number;
  members: number[];
  pairs: Array<{ master: number; slave: number; matchSort: number | null }>;
}

export interface JudgmentEntry {
  id: number;
  scientistId: number | null;
  /** HadithJudgmentSays.Say — plain. */
  say: string;
}

export interface JudgmentsPayload {
  hadithMainId: number;
  judgments: JudgmentEntry[];
  degree: number | null;
  scientistIds: number[];
}

export interface ThematicNode {
  id: number;
  parentId: number | null;
  title: string;
  isLeaf: boolean;
  hitCount: number | null;
}

export interface ThematicPayload {
  matches: ThematicNode[];
  /** Present when a leaf subject was requested — the hadith ids under it. */
  hadithIds?: number[];
}

export interface JkhssnBookHit {
  id: number;
  title: string;
  kind: 'author' | 'book';
}
