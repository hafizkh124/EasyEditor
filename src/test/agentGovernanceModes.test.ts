// @vitest-environment node
// shared/agent/loop.ts governance modes (M9 ADR-0026). Ask blocks writes; Plan
// stops before the first write until waitForApproval resolves 'approved'; Auto
// runs straight through. Also covers the clarify gate (ADR-0027 F6).
import { describe, it, expect, vi } from 'vitest';
import { runAgentLoop } from '../../shared/agent/loop';
import type { ModelStep } from '../../shared/agent/types';

function scripted(steps: ModelStep[]) {
  let i = 0;
  return vi.fn(async (): Promise<ModelStep> => steps[Math.min(i++, steps.length - 1)]);
}

describe('Plan mode', () => {
  const writeThenDone: ModelStep[] = [
    { kind: 'toolCall', name: 'set_page_layout', args: { chapter: '01.docx' } },
    { kind: 'text', text: 'done' },
  ];

  it('stops before the first write and runs it once approved', async () => {
    const dispatch = vi.fn(async () => ({ ok: true }));
    const waitForApproval = vi.fn(async () => 'approved' as const);
    const res = await runAgentLoop('lay out the page', scripted(writeThenDone), dispatch, 'sys', {
      mode: 'plan', waitForApproval,
    });
    expect(waitForApproval).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith('set_page_layout', { chapter: '01.docx' });
    expect(res.stopReason).toBe('done');
  });

  it('does not run the write when the plan is rejected', async () => {
    const dispatch = vi.fn(async () => ({ ok: true }));
    const res = await runAgentLoop('lay out the page', scripted(writeThenDone), dispatch, 'sys', {
      mode: 'plan', waitForApproval: vi.fn(async () => 'rejected' as const),
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(res.stopReason).toBe('needs-input');
  });

  it('only asks for approval once, not before every write', async () => {
    const waitForApproval = vi.fn(async () => 'approved' as const);
    const dispatch = vi.fn(async () => ({ ok: true }));
    await runAgentLoop('go', scripted([
      { kind: 'toolCall', name: 'set_page_layout', args: { chapter: '01.docx' } },
      { kind: 'toolCall', name: 'run_task', args: { chapter: '01.docx', task: 'auto-format' } },
      { kind: 'text', text: 'done' },
    ]), dispatch, 'sys', { mode: 'plan', waitForApproval });
    expect(waitForApproval).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});

describe('clarify gate (F6)', () => {
  it('a clarify step ends the run as needs-input carrying the question', async () => {
    const res = await runAgentLoop('صلاۃ', scripted([{ kind: 'clarify', question: 'فقہی احکام یا تفسیر؟' }]), vi.fn(), 'sys', { mode: 'auto' });
    expect(res.stopReason).toBe('needs-input');
    expect(res.question).toBe('فقہی احکام یا تفسیر؟');
  });
});
