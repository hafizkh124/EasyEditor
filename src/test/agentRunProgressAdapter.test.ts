// @vitest-environment node
// electron/agent/run.ts's adaptProgressForSession (M11 Phase 2 / M12 Phase H).
//
// dispatch.ts's `research_topic` case has always relayed a bounded sub-run's
// progress through `session.onProgress` — but `run.ts` never actually SET
// that field on the `AgentSession` it builds, so the relay had nothing to
// call and every research_topic sub-run went silent until it finished. This
// pins the small adapter that closes that gap, independent of `runAgent`'s
// many other dependencies (mocking the whole orchestrator just to test this
// one wire would be its own large undertaking).
import { describe, it, expect, vi } from 'vitest';
import { adaptProgressForSession } from '../../electron/agent/run.ts';
import type { AgentProgress } from '../../shared/agent/types.ts';

describe('adaptProgressForSession', () => {
  it('returns null when there is no onProgress to relay to (headless/eval caller)', () => {
    expect(adaptProgressForSession(undefined)).toBeNull();
  });

  it('relays step/label/labelKey/kind/detail through to the original callback', () => {
    const received: unknown[] = [];
    const onProgress = (p: AgentProgress) => received.push(p);
    const adapted = adaptProgressForSession(onProgress);
    expect(adapted).toBeTypeOf('function');

    adapted!({ step: 3, label: 'searching Shamela', labelKey: 'agent.step.search_shamela', kind: 'tool', detail: 'x' });
    expect(received).toEqual([
      { step: 3, label: 'searching Shamela', labelKey: 'agent.step.search_shamela', kind: 'tool', detail: 'x' },
    ]);
  });

  it("research_topic's own relay shape (dispatch.ts) — a 'research: <label>' string and a namespaced labelKey — passes through untouched", () => {
    const onProgress = vi.fn();
    const adapted = adaptProgressForSession(onProgress)!;
    adapted({ step: 2, label: 'research: searching the corpus', labelKey: 'research.agent.step.search_corpus', kind: 'tool' });
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ step: 2, label: 'research: searching the corpus', labelKey: 'research.agent.step.search_corpus', kind: 'tool' }),
    );
  });

  it('omitted optional fields (labelKey/detail) stay undefined, never coerced to a placeholder', () => {
    const onProgress = vi.fn();
    adaptProgressForSession(onProgress)!({ step: 1, label: 'thinking', kind: 'thinking' });
    expect(onProgress).toHaveBeenCalledWith({ step: 1, label: 'thinking', labelKey: undefined, kind: 'thinking', detail: undefined });
  });
});
