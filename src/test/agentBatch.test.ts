import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  planBatchItems,
  inferAggregateShape,
  buildPerItemInstruction,
  BATCH_MAX_ITEMS,
} from '../../shared/agent/batch';

// ── pure planning helpers ────────────────────────────────────────────────────
describe('shared/agent/batch — planning', () => {
  it('per-book: one item per distinct book ref, stable order, deduped', () => {
    const items = planBatchItems({
      books: ['shamela:1', 'shamela:2', 'shamela:1', 'shamela:3'],
      groups: [],
      granularity: 'per-book',
    });
    expect(items.map((i) => i.key)).toEqual(['shamela:1', 'shamela:2', 'shamela:3']);
    expect(items[0].bookRefs).toEqual(['shamela:1']);
  });

  it('per-author: one item per group, its books as the sub-scope', () => {
    const items = planBatchItems({
      books: ['shamela:1', 'shamela:2', 'shamela:9'],
      groups: [
        { type: 'author', ref: 'author:5', label: 'ابن تیمیہ', bookRefs: ['shamela:1', 'shamela:2'] },
        { type: 'author', ref: 'author:6', label: 'ابن قیم', bookRefs: ['shamela:9'] },
      ],
      granularity: 'per-author',
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ key: 'author:5', label: 'ابن تیمیہ', bookRefs: ['shamela:1', 'shamela:2'] });
    expect(items[1].bookRefs).toEqual(['shamela:9']);
  });

  it('inferAggregateShape: table verbs → table, else document', () => {
    expect(inferAggregateShape('ہر کتاب سے عبارت اور صفحہ نمبر نکال کر جدول بنائیں')).toBe('table');
    expect(inferAggregateShape('make a comparison table across these')).toBe('table');
    expect(inferAggregateShape('اس مسئلے پر ہر کتاب کی رائے بیان کریں')).toBe('document');
  });

  it('buildPerItemInstruction scopes the task to one source', () => {
    const out = buildPerItemInstruction('مسئلہ رؤیة الهلال پر کیا ہے؟', { key: 'shamela:1', label: 'فتح الباري', bookRefs: ['shamela:1'] });
    expect(out).toContain('مسئلہ رؤیة الهلال');
    expect(out).toContain('فتح الباري');
  });
});

// ── runBatch loop ───────────────────────────────────────────────────────────
const runAgent = vi.fn();
vi.mock('../../electron/agent/run.ts', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));

const batchRow = { itemsDone: [] as unknown[] };
const svc = {
  createBatchRun: vi.fn(async () => undefined),
  updateBatchRun: vi.fn(async (_id: string, u: { itemsDone?: unknown[] }) => { if (u.itemsDone) batchRow.itemsDone = u.itemsDone; }),
  loadBatchRun: vi.fn(async () => batchRow),
};
vi.mock('../../electron/ipc/workspaceHandlers.ts', () => ({ getWorkspaceDbService: async () => svc }));

const { runBatch } = await import('../../electron/agent/batch');

const baseInput = { instruction: 'اس مسئلے پر کیا ہے؟', mode: 'ask' as const, projectRoot: 'C:\\p' };
const okResult = (answer: string) => ({ answer, messages: [], toolCalls: [], steps: 1, stopReason: 'done' as const });

beforeEach(() => {
  runAgent.mockReset();
  batchRow.itemsDone = [];
  svc.createBatchRun.mockClear();
  svc.updateBatchRun.mockClear();
});

describe('electron/agent/batch — runBatch', () => {
  const scope = (books: string[], granularity: 'per-book' | 'per-author' = 'per-book') => ({
    books,
    groups: [],
    batch: { granularity },
  });

  it('over the cap → needs-input, never calls runAgent', async () => {
    const books = Array.from({ length: BATCH_MAX_ITEMS + 3 }, (_, i) => `shamela:${i}`);
    const out = await runBatch(baseInput, scope(books), { onProgress: vi.fn(), isCancelled: () => false });
    expect(out.stopReason).toBe('needs-input');
    expect(out.question).toContain(String(BATCH_MAX_ITEMS));
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('loops once per book and aggregates a document', async () => {
    runAgent.mockImplementation(async (input: { instruction: string }) =>
      okResult(input.instruction.includes('فتح') ? 'answer A' : 'answer B'),
    );
    const progress = vi.fn();
    const out = await runBatch(baseInput, scope(['shamela:1', 'shamela:2']), { onProgress: progress, isCancelled: () => false });
    expect(runAgent).toHaveBeenCalledTimes(2);
    expect(out.stopReason).toBe('done');
    // the aggregated document artifact got at least one append per item
    const appends = progress.mock.calls.filter(([p]) => p.kind === 'artifact' && p.artifact?.op === 'delta');
    expect(appends.length).toBeGreaterThanOrEqual(2);
  });

  it('continues past a failed item and records it', async () => {
    runAgent
      .mockImplementationOnce(async () => { throw new Error('boom'); })
      .mockImplementationOnce(async () => okResult('ok'));
    const out = await runBatch(baseInput, scope(['shamela:1', 'shamela:2']), { onProgress: vi.fn(), isCancelled: () => false });
    expect(runAgent).toHaveBeenCalledTimes(2);
    expect(out.answer).toContain('ناکام');
  });

  it('resume skips items already recorded done', async () => {
    batchRow.itemsDone = [{ key: 'shamela:1', label: 'shamela:1', answer: 'prior', citations: null, tableRows: [] }];
    runAgent.mockImplementation(async () => okResult('second only'));
    await runBatch(baseInput, scope(['shamela:1', 'shamela:2']), { onProgress: vi.fn(), isCancelled: () => false, resumeFrom: 'batch-abc' });
    expect(runAgent).toHaveBeenCalledTimes(1);
  });
});
