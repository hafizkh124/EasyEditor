// @vitest-environment node
// shared/agent/loop.ts — the agentic loop (SPEC-M8 §3, ADR-0016). The model
// and the dispatcher are injected, so this pins the control flow that makes
// the loop safe: the model can only return a tool call from the CLOSED
// registry or a final answer; an unknown tool is fed back as an error, not
// executed; Ask mode refuses write tools; the step limit and cancellation
// both stop a runaway loop.
import { describe, it, expect, vi } from 'vitest';
import { runAgentLoop, compactMessages } from '../../shared/agent/loop';
import type { ModelStep, AgentMessage, AgentTool } from '../../shared/agent/types';

/** A model that plays a fixed script of steps, one per call. */
function scriptedModel(steps: ModelStep[]) {
  let i = 0;
  return vi.fn(async (): Promise<ModelStep> => steps[Math.min(i++, steps.length - 1)]);
}

const opts = (over: Partial<Parameters<typeof runAgentLoop>[4]> = {}) => ({ mode: 'auto' as const, ...over });

describe('runAgentLoop', () => {
  it('runs a tool call, feeds the result back, then returns the final answer', async () => {
    const model = scriptedModel([
      { kind: 'toolCall', name: 'read_document', args: { chapter: '01.docx' } },
      { kind: 'text', text: 'The chapter has 3 headings.' },
    ]);
    const dispatch = vi.fn(async () => ({ headings: ['a', 'b', 'c'] }));

    const res = await runAgentLoop('summarise the chapter', model, dispatch, 'sys', opts());

    expect(dispatch).toHaveBeenCalledWith('read_document', { chapter: '01.docx' });
    expect(res.stopReason).toBe('done');
    expect(res.answer).toBe('The chapter has 3 headings.');
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0].result).toEqual({ headings: ['a', 'b', 'c'] });
    // conversation: user, model(toolCall), tool(result), model(text)
    expect(res.messages.map((m: AgentMessage) => m.role)).toEqual(['user', 'model', 'tool', 'model']);
  });

  it('prepends opts.history so a follow-up run has the thread (M11 Phase 1, ADR-0046)', async () => {
    // Snapshot inside the mock — the loop passes its live `messages` array by
    // reference (compactMessages is a no-op below the tool-result threshold),
    // and it mutates it after this call returns.
    let seenRoles: string[] = [];
    let seenTexts: string[] = [];
    const model = vi.fn(async (msgs: AgentMessage[]): Promise<ModelStep> => {
      seenRoles = msgs.map((m) => m.role);
      seenTexts = msgs.map((m) => ("text" in m ? m.text ?? "" : ""));
      return { kind: "text", text: "the third point is X" };
    });
    const history: AgentMessage[] = [
      { role: "user", text: "summarise chapter one" },
      { role: "model", text: "It makes three points." },
    ];
    const res = await runAgentLoop("open the third point", model, vi.fn(), "sys", opts({ history }));

    expect(seenRoles).toEqual(["user", "model", "user"]);
    expect(seenTexts[0]).toBe("summarise chapter one");
    expect(seenTexts[2]).toBe("open the third point");
    expect(res.answer).toBe("the third point is X");
  });

  it('feeds an unknown tool name back as an error instead of dispatching it', async () => {
    const model = scriptedModel([
      { kind: 'toolCall', name: 'delete_everything', args: {} },
      { kind: 'text', text: 'ok' },
    ]);
    const dispatch = vi.fn();
    const res = await runAgentLoop('go', model, dispatch, 'sys', opts());
    expect(dispatch).not.toHaveBeenCalled();
    const toolMsg = res.messages.find((m: AgentMessage) => m.role === 'tool') as { result: { error: string } };
    expect(toolMsg.result.error).toMatch(/unknown tool/);
  });

  it('blocks a write tool in Ask mode', async () => {
    const model = scriptedModel([
      { kind: 'toolCall', name: 'insert_footnote', args: { chapter: '01.docx', marker: '[1]', source_id: 'x' } },
      { kind: 'text', text: 'done' },
    ]);
    const dispatch = vi.fn();
    const res = await runAgentLoop('add a footnote', model, dispatch, 'sys', opts({ mode: 'ask' }));
    expect(dispatch).not.toHaveBeenCalled();
    const toolMsg = res.messages.find((m: AgentMessage) => m.role === 'tool') as { result: { error: string } };
    expect(toolMsg.result.error).toMatch(/Ask mode/);
  });

  it('a dispatch failure becomes a tool error the loop keeps going from', async () => {
    const model = scriptedModel([
      { kind: 'toolCall', name: 'search_corpus', args: { query: 'x' } },
      { kind: 'text', text: 'no results, sorry' },
    ]);
    const dispatch = vi.fn(async () => { throw new Error('db locked'); });
    const res = await runAgentLoop('find it', model, dispatch, 'sys', opts());
    expect(res.stopReason).toBe('done');
    expect(res.toolCalls[0].result).toEqual({ error: 'db locked' });
  });

  it('stops at the step limit', async () => {
    const model = scriptedModel([{ kind: 'toolCall', name: 'read_document', args: { chapter: '01.docx' } }]);
    const dispatch = vi.fn(async () => ({}));
    const res = await runAgentLoop('loop forever', model, dispatch, 'sys', opts({ maxSteps: 3 }));
    expect(res.stopReason).toBe('step-limit');
    expect(res.steps).toBe(3);
  });

  it('stops when cancelled between steps', async () => {
    let calls = 0;
    const model = vi.fn(async (): Promise<ModelStep> => {
      calls += 1;
      return { kind: 'toolCall', name: 'read_document', args: { chapter: '01.docx' } };
    });
    const dispatch = vi.fn(async () => ({}));
    const res = await runAgentLoop('go', model, dispatch, 'sys', opts({ isCancelled: () => calls >= 1 }));
    expect(res.stopReason).toBe('cancelled');
  });

  it('emits a progress event per step', async () => {
    const model = scriptedModel([
      { kind: 'toolCall', name: 'search_shamela', args: { query: 'x' } },
      { kind: 'text', text: 'here' },
    ]);
    const onProgress = vi.fn();
    await runAgentLoop('go', model, vi.fn(async () => ({})), 'sys', opts({ onProgress }));
    const kinds = onProgress.mock.calls.map((c) => c[0].kind);
    expect(kinds).toContain('tool');
    expect(kinds).toContain('tool-result');
    expect(kinds).toContain('done');
  });

  it('never exposes write tools to the model in Ask mode', async () => {
    const model = vi.fn(async (_m: AgentMessage[], tools: AgentTool[]): Promise<ModelStep> => {
      expect(tools.every((t) => t.effect === 'read')).toBe(true);
      return { kind: 'text', text: 'ok' };
    });
    await runAgentLoop('q', model, vi.fn(), 'sys', opts({ mode: 'ask' }));
    expect(model).toHaveBeenCalled();
  });

  it('compacts old tool results but keeps the full transcript (M9 Phase E)', async () => {
    let sawStubbed = false;
    const model = vi.fn(async (m: AgentMessage[]): Promise<ModelStep> => {
      const toolMsgs = m.filter((x) => x.role === 'tool');
      if (toolMsgs.length > 5) {
        const first = toolMsgs[0].result as Record<string, unknown>;
        if (first && 'summarized' in first) sawStubbed = true;
        return { kind: 'text', text: 'done' };
      }
      return { kind: 'toolCall', name: 'search_corpus', args: { query: 'x' } };
    });
    const dispatch = vi.fn(async () => ({ results: [{ id: 'c', reference: 'ref' }], excerpt: 'a'.repeat(400) }));
    const res = await runAgentLoop('go', model, dispatch, 'sys', opts());
    expect(sawStubbed).toBe(true); // the model saw compacted history
    // the returned transcript still has the real results
    const realTool = res.messages.filter((x) => x.role === 'tool')[0].result as Record<string, unknown>;
    expect(realTool).not.toHaveProperty('summarized');
    expect(realTool).toHaveProperty('results');
  });
});

describe('compactMessages', () => {
  const tool = (name: string, result: unknown): AgentMessage => ({ role: 'tool', name, result });

  it('is a no-op below the keep threshold', () => {
    const msgs: AgentMessage[] = [{ role: 'user', text: 'q' }, tool('search_corpus', { results: [1, 2] })];
    expect(compactMessages(msgs)).toBe(msgs);
  });

  it('stubs everything older than the last 5 tool results, by kind', () => {
    const msgs: AgentMessage[] = [];
    for (let i = 0; i < 8; i += 1) {
      msgs.push({ role: 'model', toolCall: { name: 'search_corpus', args: {} } });
      msgs.push(tool('search_corpus', i === 2 ? { error: 'nope' } : { results: new Array(i + 1).fill(0) }));
    }
    const out = compactMessages(msgs);
    const tools = out.filter((m) => m.role === 'tool');
    expect((tools[0].result as { summarized?: string }).summarized).toMatch(/search_corpus → 1 result/);
    expect((tools[2].result as { summarized?: string }).summarized).toMatch(/error: nope/);
    // last 5 stay verbatim
    expect(tools[7].result).toEqual({ results: new Array(8).fill(0) });
  });
});
