// @vitest-environment node
// electron/agent/generalSearch.ts — the main↔renderer bridge for
// search_general (SPEC-M8 §9, ADR-0019 item 7). What must hold: a request
// always resolves (never rejects), a renderer reply resolves it with the
// channel tag intact, and a silent renderer resolves to a CLEAR error, not an
// empty answer.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({}));
vi.mock('../../electron/ipc/registry.ts', () => ({ ALLOWED_IPC_CHANNELS: { AGENT_PROGRESS: 'agent:progress' } }));

let mod: typeof import('../../electron/agent/generalSearch.ts');

beforeEach(async () => {
  vi.resetModules();
  vi.useRealTimers();
  mod = await import('../../electron/agent/generalSearch.ts');
});

function fakeSender() {
  const sent: unknown[] = [];
  return {
    sent,
    wc: { isDestroyed: () => false, send: (_ch: string, payload: unknown) => sent.push(payload) },
  };
}

describe('requestGeneralSearch', () => {
  it('sends a general-search-request and resolves when the renderer replies, keeping the channel', async () => {
    const { wc, sent } = fakeSender();
    const p = mod.requestGeneralSearch('run_1', 'who was al-Ghazali', wc as never);

    const req = sent[0] as { kind: string; requestId: string; query: string; id: string };
    expect(req).toMatchObject({ kind: 'general-search-request', query: 'who was al-Ghazali', id: 'run_1' });

    mod.resolveGeneralSearch(req.requestId, { answer: 'a theologian', channel: 'general' });
    await expect(p).resolves.toEqual({ answer: 'a theologian', channel: 'general' });
  });

  it('times out to a clear error rather than an empty answer', async () => {
    vi.useFakeTimers();
    const { wc } = fakeSender();
    const p = mod.requestGeneralSearch('run_2', 'x', wc as never);
    await vi.advanceTimersByTimeAsync(60_001);
    const r = await p;
    expect(r.error).toMatch(/internet connection and a signed-in session/);
    expect(r.answer).toBeUndefined();
  });

  it('resolves immediately when there is no window to ask', async () => {
    const r = await mod.requestGeneralSearch('run_3', 'x', null);
    expect(r.error).toMatch(/window is gone/);
  });

  it('a reply for an unknown request id is ignored, not thrown', () => {
    expect(() => mod.resolveGeneralSearch('nope', { answer: 'x' })).not.toThrow();
  });
});
