// @vitest-environment node
// electron/agent/runPlaybook.ts (M9 ADR-0020 + Phase 4 repeat steps). The
// runner owns control flow: fully-bound steps dispatch with no model call, a
// `bind` step gets ONE forced call, a `repeat` step runs once per remaining
// item (bounded), and a failed non-optional step hands off to the free loop.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Playbook } from '../../shared/playbooks/registry';

const generateBoundCall = vi.fn();
const generateWithTools = vi.fn();
vi.mock('../../electron/agent/geminiTools.ts', () => ({ generateBoundCall, generateWithTools }));

const runAgentLoop = vi.fn(async () => ({ answer: 'loop finished', messages: [], toolCalls: [], steps: 1, stopReason: 'done' as const }));
vi.mock('../../shared/agent/loop.ts', async (orig) => ({ ...(await orig()), runAgentLoop }));

let runPlaybook: typeof import('../../electron/agent/runPlaybook').runPlaybook;
beforeEach(async () => {
  vi.clearAllMocks();
  ({ runPlaybook } = await import('../../electron/agent/runPlaybook'));
});

const base = {
  systemPrompt: 'sys',
  fallbackTools: [],
  context: { instruction: 'do the thing', chapter: '01.docx' },
};

describe('runPlaybook', () => {
  it('runs a fully-seeded step with NO model call', async () => {
    const pb: Playbook = { id: 'p', title: 'P', keywords: [], steps: [{ tool: 'run_task', args: { task: 'harakat' }, note: 'harakat' }] };
    const dispatch = vi.fn(async () => ({ ok: true, revisions: 2 }));
    const r = await runPlaybook({ ...base, playbook: pb, instruction: 'x', mode: 'auto', dispatch });
    expect(generateBoundCall).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith('run_task', { task: 'harakat', chapter: '01.docx' });
    expect(r.stopReason).toBe('done');
  });

  it('a `bind` step gets one forced single-tool call, and a different tool → loop fallback', async () => {
    const pb: Playbook = { id: 'p', title: 'P', keywords: [], steps: [{ tool: 'search_shamela', bind: ['query'], note: 'search' }] };
    generateBoundCall.mockResolvedValueOnce({ name: 'search_general', args: { query: 'x' } }); // wrong tool
    const dispatch = vi.fn();
    const r = await runPlaybook({ ...base, playbook: pb, instruction: 'x', mode: 'auto', dispatch });
    expect(runAgentLoop).toHaveBeenCalled();
    expect(r.answer).toBe('loop finished');
  });

  it('a `repeat` step runs once per "yes", stopping on "no" (bounded)', async () => {
    const pb: Playbook = {
      id: 'p', title: 'P', keywords: [],
      steps: [{ tool: 'add_document_comment', bind: ['anchor_text', 'comment'], repeat: true, note: 'comment each finding' }],
    };
    generateBoundCall.mockResolvedValue({ name: 'add_document_comment', args: { chapter: '01.docx', anchor_text: 'a', comment: 'c' } });
    // hasMore(): yes, yes, no
    generateWithTools
      .mockResolvedValueOnce({ kind: 'text', text: 'yes' })
      .mockResolvedValueOnce({ kind: 'text', text: 'yes' })
      .mockResolvedValueOnce({ kind: 'text', text: 'no' });
    const dispatch = vi.fn(async () => ({ added: true }));
    await runPlaybook({ ...base, playbook: pb, instruction: 'x', mode: 'auto', dispatch });
    expect(dispatch).toHaveBeenCalledTimes(3); // 1 + 2 repeats
  });

  it('Plan mode stops before the first write step until waitForApproval resolves', async () => {
    const pb: Playbook = { id: 'p', title: 'P', keywords: [], steps: [{ tool: 'run_task', args: { task: 'harakat' }, note: 'harakat' }] };
    const dispatch = vi.fn(async () => ({ ok: true }));
    const waitForApproval = vi.fn(async () => 'rejected' as const);
    const r = await runPlaybook({ ...base, playbook: pb, instruction: 'x', mode: 'plan', dispatch, waitForApproval });
    expect(waitForApproval).toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(r.stopReason).toBe('needs-input');
  });

  it('skips a step whose source connector is switched off (M9 Phase 1b)', async () => {
    const pb: Playbook = {
      id: 'p', title: 'P', keywords: [],
      steps: [
        { tool: 'search_shamela', bind: ['query'], note: 'search shamela' },
        { tool: 'search_corpus', bind: ['query'], note: 'search corpus' },
      ],
    };
    generateBoundCall.mockResolvedValue({ name: 'search_corpus', args: { query: 'x' } });
    generateWithTools.mockResolvedValueOnce({ kind: 'text', text: 'answer' });
    const dispatch = vi.fn(async () => ({ count: 1, results: [] }));
    await runPlaybook({
      ...base, playbook: pb, instruction: 'x', mode: 'auto', dispatch,
      disabledTools: new Set(['search_shamela']),
    });
    // only search_corpus was dispatched; the disabled step was skipped
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith('search_corpus', expect.anything());
  });

  it('stops at a step that returns needsConsent — later steps never run, and it is not reported as "applied"', async () => {
    // A real bug: ocr_document's needsConsent result has no `error` key, so
    // it was counted as a completed step and the playbook went on to build a
    // chapter from OCR text that was never produced — then claimed "2 of 2
    // steps applied".
    const pb: Playbook = {
      id: 'p', title: 'P', keywords: [],
      steps: [
        { tool: 'ocr_document', args: { scan_path: 'sources/x.png' }, note: 'ocr the scan' },
        { tool: 'create_chapter', args: { name: 'x.docx' }, note: 'build the chapter' },
      ],
    };
    const dispatch = vi.fn(async (tool: string) =>
      tool === 'ocr_document' ? { needsConsent: true, scanPath: 'sources/x.png', message: 'approve OCR' } : { ok: true },
    );
    const r = await runPlaybook({ ...base, playbook: pb, instruction: 'x', mode: 'auto', dispatch });
    expect(dispatch).toHaveBeenCalledTimes(1); // create_chapter never ran
    expect(r.toolCalls).toHaveLength(1);
    expect(r.stopReason).toBe('done');
    expect(r.answer).not.toMatch(/steps applied/);
  });

  it('Ask mode skips write steps and still returns a synthesised answer', async () => {
    const pb: Playbook = {
      id: 'p', title: 'P', keywords: [],
      steps: [
        { tool: 'search_shamela', bind: ['query'], note: 'search' },
        { tool: 'insert_footnote', bind: ['marker', 'source_id'], note: 'footnote' },
      ],
    };
    generateBoundCall.mockResolvedValue({ name: 'search_shamela', args: { query: 'x' } });
    generateWithTools.mockResolvedValueOnce({ kind: 'text', text: 'Here is the sourced answer.' });
    const dispatch = vi.fn(async () => ({ count: 2, results: [] }));
    const r = await runPlaybook({ ...base, playbook: pb, instruction: 'x', mode: 'ask', dispatch });
    expect(dispatch).toHaveBeenCalledTimes(1); // only the read step
    expect(r.answer).toBe('Here is the sourced answer.');
  });
});
