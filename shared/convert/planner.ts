/**
 * M8 Layer 3 (seed) — conversion planner (SPEC-M8 §3 "Layer 3", §4).
 *
 * Pure: under shared/, imported by the main process (to run a conversion) and
 * by the renderer (to show the loss list *before* running one). No runtime
 * globals — see scripts/check-shared-purity.mjs.
 *
 * P3 scope: direct single-adapter routes only (from ∈ adapter.reads, to ∈
 * adapter.writes), plus the one two-node special case Word gives for free
 * (pdf → docx via reflow). The full best-path graph search over multiple
 * adapters is P8; the shape here — `{ steps, losses }` or a clear refusal —
 * is what that will return too.
 */
import type { AdapterDescriptor, DocFormat, FormatEdge } from '../adapters/types.js';

export interface ConversionStep {
  adapterId: string;
  from: DocFormat;
  to: DocFormat;
  /** The adapter op that performs this step. */
  op: 'exportDocument' | 'reflowPdf';
}

export type ConversionPlan =
  | { ok: true; steps: ConversionStep[]; losses: string[] }
  | { ok: false; reason: string };

export interface PlanInput {
  from: DocFormat;
  to: DocFormat;
  adapters: AdapterDescriptor[];
}

function edge(edges: FormatEdge[], fmt: DocFormat): FormatEdge | undefined {
  return edges.find((e) => e.format === fmt);
}

/**
 * Find how to get from `from` to `to`. Returns the ordered steps and every
 * lossy warning the chosen route carries, or a refusal naming what's missing —
 * never a best-effort guess (ADR-0017).
 */
export function planConversion({ from, to, adapters }: PlanInput): ConversionPlan {
  if (from === to) {
    return { ok: false, reason: `Source and target are both "${from}".` };
  }

  // A PDF source is only ever recoverable via Word's reflow (its text layer
  // becomes an editable .docx); it is not a plain "open and re-save".
  if (from === 'pdf') {
    if (to !== 'docx') {
      return { ok: false, reason: 'A PDF can only be converted to an editable Word document (its text layer).' };
    }
    const word = adapters.find((a) => a.id === 'word' && a.ops.includes('reflowPdf'));
    if (!word) return { ok: false, reason: 'PDF reflow needs Microsoft Word, which is not available.' };
    const r = edge(word.reads, 'pdf');
    return {
      ok: true,
      steps: [{ adapterId: word.id, from, to, op: 'reflowPdf' }],
      losses: r?.lossy ? [r.lossy] : ['Exact page layout is lost; only the text layer is recovered.'],
    };
  }

  // Direct route: one adapter that reads `from` and writes `to`.
  for (const a of adapters) {
    const r = edge(a.reads, from);
    const w = edge(a.writes, to);
    if (r && w) {
      const losses = [r.lossy, w.lossy].filter((s): s is string => Boolean(s));
      return {
        ok: true,
        steps: [{ adapterId: a.id, from, to, op: 'exportDocument' }],
        losses,
      };
    }
  }

  const canRead = adapters.some((a) => edge(a.reads, from));
  const canWrite = adapters.some((a) => edge(a.writes, to));
  if (!canRead && !canWrite) {
    return { ok: false, reason: `No installed tool can read "${from}" or write "${to}".` };
  }
  if (!canRead) return { ok: false, reason: `No installed tool can read "${from}".` };
  if (!canWrite) return { ok: false, reason: `No installed tool can write "${to}".` };
  return { ok: false, reason: `No installed tool can convert "${from}" to "${to}" in one step.` };
}

/** Just the loss list for a `from → to` pair (or null if there is no route). */
export function conversionLosses(input: PlanInput): string[] | null {
  const plan = planConversion(input);
  return plan.ok ? plan.losses : null;
}
