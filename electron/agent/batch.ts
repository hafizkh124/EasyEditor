/**
 * Plan §4.6 — batch mode. A multi-book `#` scope can be run either as one
 * scoped search (handled by `runAgent` + `session.bookScope`) or, when the
 * scholar picked «ہر کتاب پر الگ کام» / «ہر مصنف پر الگ» in the review dialog,
 * as N separate sub-runs whose answers are folded into one artifact.
 *
 * This is the loop. The pure planning helpers live in `shared/agent/batch.ts`.
 * Each sub-run is a full `runAgent(...)` with its own `session.bookScope`, so
 * there is no shared mutable state between items (each gets its own ledger,
 * checkpoint and progress sink).
 */
import { randomUUID } from 'node:crypto';
import { logger } from '../lib/logger.js';
import { runAgent, type AgentRunInput, type AgentRunOutput } from './run.js';
import { getWorkspaceDbService } from '../ipc/workspaceHandlers.js';
import {
  BATCH_MAX_ITEMS,
  planBatchItems,
  inferAggregateShape,
  buildPerItemInstruction,
  type BatchItem,
} from '../../shared/agent/batch.js';
import type { AgentProgress, AgentArtifactEvent } from '../../shared/agent/types.js';

const log = logger.child('agent/batch');

/** The validated scope shape `agentHandlers.ts` builds from the IPC payload. */
export interface BatchRunScope {
  books: string[];
  groups: Array<{ type: string; ref: string; label: string; bookRefs: string[] }>;
  batch: { granularity: 'per-book' | 'per-author' } | null;
}

interface BatchOpts {
  onProgress: (p: AgentProgress) => void;
  isCancelled: () => boolean;
  /** Resume a persisted batch — skip items already recorded done. */
  resumeFrom?: string;
}

interface ItemResult {
  key: string;
  label: string;
  answer: string;
  citations: AgentArtifactEvent | null;
  tableRows: string[][];
  error?: string;
}

const CAP_QUESTION = (n: number): string =>
  `یہ دائرہ ${n} کتب/مصنفین پر مشتمل ہے — بیچ زیادہ سے زیادہ ${BATCH_MAX_ITEMS} پر چل سکتا ہے۔ ` +
  `دائرہ تنگ کریں: کیٹگری + صدی ملا کر، کلیدی لفظ شامل کر کے، یا فہرست سے کم کتب منتخب کر کے۔`;

/**
 * Run one agent turn per book (or per author) and aggregate the answers.
 * Returns the same `AgentRunOutput` shape a single `runAgent` does, so
 * `agentHandlers.ts` treats a batch and a normal run identically.
 */
export async function runBatch(
  base: AgentRunInput,
  scope: BatchRunScope,
  opts: BatchOpts,
): Promise<AgentRunOutput> {
  const granularity = scope.batch?.granularity ?? 'per-book';
  const items = planBatchItems({
    books: scope.books,
    groups: scope.groups.map((g) => ({ type: g.type, ref: g.ref, label: g.label, bookRefs: g.bookRefs })),
    granularity,
  });

  // ── Cap gate (plan §4.6 / approved Q3) ─────────────────────────────────
  if (items.length > BATCH_MAX_ITEMS) {
    return {
      answer: '',
      messages: [],
      toolCalls: [],
      steps: 0,
      stopReason: 'needs-input',
      question: CAP_QUESTION(items.length),
    };
  }
  if (items.length === 0) {
    return {
      answer: 'بیچ کے لیے کوئی کتاب منتخب نہیں — دائرہ خالی ہے۔',
      messages: [],
      toolCalls: [],
      steps: 0,
      stopReason: 'done',
    };
  }

  const aggregate = inferAggregateShape(base.instruction);
  const artifactId = `batch-${Date.now().toString(36)}`;
  const emit = (ev: AgentArtifactEvent) => opts.onProgress({ kind: 'artifact', artifact: ev });

  // ── Resumability — a `batch_runs` row so a force-quit can pick up later ──
  const svc = await getWorkspaceDbService().catch(() => null);
  let batchId = opts.resumeFrom ?? null;
  const doneKeys = new Set<string>();
  const priorResults: ItemResult[] = [];
  if (svc && batchId) {
    try {
      const row = await svc.loadBatchRun(batchId);
      for (const r of (row?.itemsDone ?? []) as ItemResult[]) {
        doneKeys.add(r.key);
        priorResults.push(r);
      }
    } catch (err) {
      log.warn('could not load the batch run to resume', { message: (err as Error).message });
    }
  }
  if (svc && !batchId) {
    batchId = randomUUID();
    try {
      await svc.createBatchRun({
        id: batchId,
        instruction: base.instruction,
        scopeJson: JSON.stringify(scope),
        granularity,
        aggregate,
        itemsTotal: items.length,
      });
    } catch (err) {
      log.warn('could not open a batch_runs row', { message: (err as Error).message });
      batchId = null;
    }
  }

  emit({ op: 'open', artifactId, title: 'بیچ نتائج', artifactType: aggregate === 'table' ? 'table' : 'document' });

  const started = Date.now();
  opts.onProgress({
    kind: 'batch-item',
    step: 0,
    total: items.length,
    label: `${items.length} ${granularity === 'per-author' ? 'مصنفین' : 'کتب'} پر بیچ چل رہا ہے`,
  });

  const results: ItemResult[] = [...priorResults];
  const tableColumns = [granularity === 'per-author' ? 'مصنف' : 'کتاب', 'جواب', 'حوالہ'];
  if (aggregate === 'table') {
    emit({ op: 'table', artifactId, columns: tableColumns, rows: results.flatMap((r) => r.tableRows) });
  }

  let steps = 0;
  const toolCalls: AgentRunOutput['toolCalls'] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (opts.isCancelled()) {
      opts.onProgress({ kind: 'batch-item', step: i, total: items.length, label: 'بیچ منسوخ' });
      break;
    }
    if (doneKeys.has(item.key)) continue;

    opts.onProgress({
      kind: 'batch-item',
      step: i + 1,
      total: items.length,
      label: `${i + 1} / ${items.length} — ${item.label}`,
      detail: `${Math.round((Date.now() - started) / 1000)}s`,
    });

    const r = await runOneItem(base, item, opts.isCancelled).catch(
      (err): ItemResult => ({
        key: item.key,
        label: item.label,
        answer: '',
        citations: null,
        tableRows: [],
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    results.push(r);
    steps += 1;

    // The aggregated artifact grows live so there is something to read.
    if (aggregate === 'table') {
      emit({ op: 'table', artifactId, columns: tableColumns, rows: results.flatMap((x) => x.tableRows) });
    } else {
      emit({
        op: 'delta',
        artifactId,
        mode: 'append',
        text: `\n\n## ${item.label}\n\n${r.error ? `⚠️ ${r.error}` : r.answer || 'اس ماخذ میں کچھ نہیں ملا۔'}`,
      });
    }
    if (r.citations) emit({ ...r.citations, artifactId });

    if (svc && batchId) {
      await svc
        .updateBatchRun(batchId, { itemsDone: results, status: i + 1 >= items.length ? 'done' : 'running' })
        .catch(() => undefined);
    }
  }

  const failures = results.filter((r) => r.error);
  emit({ op: 'close', artifactId, status: 'final' });
  opts.onProgress({
    kind: 'batch-item',
    step: items.length,
    total: items.length,
    label: `بیچ مکمل — ${results.length - failures.length}/${items.length}${failures.length ? `، ${failures.length} ناکام` : ''}`,
  });

  const answer =
    `${items.length} ${granularity === 'per-author' ? 'مصنفین' : 'کتب'} پر بیچ مکمل ہوا — ` +
    `${results.length - failures.length} کامیاب${failures.length ? `، ${failures.length} ناکام (${failures.map((f) => f.label).join('، ')})` : ''}۔ ` +
    `تفصیل بیچ نتائج کے آرٹفیکٹ میں ہے۔`;

  return {
    answer,
    messages: [],
    toolCalls,
    steps,
    stopReason: opts.isCancelled() ? 'cancelled' : 'done',
  };
}

/** One sub-run: `runAgent` scoped to this item's books, with a per-item task. */
async function runOneItem(
  base: AgentRunInput,
  item: BatchItem,
  isCancelled: () => boolean,
): Promise<ItemResult> {
  const out = await runAgent({
    ...base,
    instruction: buildPerItemInstruction(base.instruction, item),
    // A sub-run never streams its own step lines into the batch progress row;
    // the batch loop owns progress. Artifacts/plan-approval are also suppressed.
    onProgress: undefined,
    waitForApproval: undefined,
    isCancelled,
    scope: {
      books: item.bookRefs,
      groups: [],
      playbook: base.scope?.playbook ?? null,
      mentions: base.scope?.mentions ?? [],
      batch: null,
    },
  });

  const citationCall = out.toolCalls.find(
    (c) => c.result && typeof c.result === 'object' && 'results' in (c.result as Record<string, unknown>),
  );
  const refs =
    citationCall && Array.isArray((citationCall.result as { results?: unknown[] }).results)
      ? ((citationCall.result as { results: Array<{ reference?: string }> }).results)
          .map((x) => x.reference)
          .filter((x): x is string => Boolean(x))
      : [];

  return {
    key: item.key,
    label: item.label,
    answer: out.answer ?? '',
    citations: refs.length
      ? {
          op: 'citations',
          artifactId: '',
          entries: refs.slice(0, 8).map((reference, i) => ({
            marker: `${item.label} · ${i + 1}`,
            reference,
            sourceId: `${item.key}:${i}`,
            supported: true,
          })),
        }
      : null,
    tableRows: [[item.label, (out.answer ?? '').replace(/\s+/g, ' ').slice(0, 500), refs[0] ?? '—']],
    error: out.stopReason === 'error' ? out.error ?? 'نامعلوم خرابی' : undefined,
  };
}
