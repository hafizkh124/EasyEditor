// @vitest-environment node
// M9 Phase C/E — the reasoning-model critic (shared/ai/prompts/critique.ts +
// electron/agent/critic.ts). What must hold: a CLOSED kind set; the critic
// runs with NO tools; it prefers the provider's reasoningModel; <think> is
// stripped; and any failure degrades to a short note (never throws).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CRITIQUE_KINDS, buildCritiqueInstruction, buildCritiqueInput, type CritiqueKind,
} from '../../shared/ai/prompts/critique';
import { PROVIDERS } from '../../shared/agent/providers';

const GROQ_REASONING = PROVIDERS.groq.reasoningModel;

describe('critique prompts', () => {
  it('exposes exactly the five kinds, each with a distinct instruction', () => {
    expect(CRITIQUE_KINDS).toEqual(['plan', 'draft', 'argument', 'takhrij', 'sourcing']);
    const seen = new Set<string>();
    for (const k of CRITIQUE_KINDS) {
      const inst = buildCritiqueInstruction(k);
      expect(inst).toMatch(/muḥaqqiq|critic/i);
      expect(inst).toMatch(/do not rewrite/i);
      seen.add(inst);
    }
    expect(seen.size).toBe(5);
  });

  it('folds the author focus into the instruction', () => {
    expect(buildCritiqueInstruction('draft', 'the hadith grading')).toMatch(/the hadith grading/);
  });

  it('lays the input out as context / sources / work', () => {
    const s = buildCritiqueInput({ subject: 'THE DRAFT', context: 'CTX', sources: 'EXC' });
    expect(s.indexOf('CTX')).toBeLessThan(s.indexOf('EXC'));
    expect(s.indexOf('EXC')).toBeLessThan(s.indexOf('THE DRAFT'));
  });
});

// ── critic.ts routing ──────────────────────────────────────────────────────

const generateContentStream = vi.fn(async () => 'الحكم: سليم مع إصلاحات.\nالإشكالات: 1. …');
vi.mock('../../electron/ai/geminiClient.ts', () => ({ generateContentStream, ByokApiError: class extends Error {} }));

const chatCompletion = vi.fn(async (_req: { model: string; tools?: unknown; messages: unknown[] }) =>
  ({ role: 'assistant', content: '<think>let me weigh it</think>\nالحكم: غير سليم بعد.' }));
vi.mock('../../electron/ai/openAiCompatibleClient.ts', () => ({ chatCompletion }));

const getProviderKey = vi.fn<(p: string) => Promise<string | null>>(async () => 'k');
vi.mock('../../electron/ai/keyStore.ts', () => ({ getProviderKey }));

const getCriticProviderId = vi.fn<() => 'gemini' | 'groq' | 'openrouter'>(() => 'gemini');
vi.mock('../../electron/ai/providerConfig.ts', async (orig) => ({
  ...(await orig<typeof import('../../electron/ai/providerConfig.ts')>()),
  getCriticProviderId,
}));

let runCritique: typeof import('../../electron/agent/critic').runCritique;
beforeEach(async () => {
  vi.clearAllMocks();
  ({ runCritique } = await import('../../electron/agent/critic'));
});

const req = (over: Partial<{ kind: CritiqueKind; subject: string }> = {}) => ({ kind: 'plan' as CritiqueKind, subject: 'do X then Y', ...over });

describe('runCritique', () => {
  it('routes a gemini critic through generateContentStream (no tools path)', async () => {
    getCriticProviderId.mockReturnValue('gemini');
    const r = await runCritique(req());
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/الحكم/);
    expect(generateContentStream).toHaveBeenCalledWith(expect.objectContaining({ model: expect.any(String) }));
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it('routes an openai-compat critic through chatCompletion, prefers reasoningModel, strips <think>', async () => {
    getCriticProviderId.mockReturnValue('groq');
    const r = await runCritique(req({ kind: 'takhrij' }));
    expect(r.ok).toBe(true);
    expect(r.text).toBe('الحكم: غير سليم بعد.');
    const call = chatCompletion.mock.calls[0][0];
    expect(call.model).toBe(GROQ_REASONING);
    expect(call.tools).toBeUndefined(); // the critic NEVER gets tools
  });

  it('degrades to a note when the provider throws — never rejects', async () => {
    getCriticProviderId.mockReturnValue('groq');
    chatCompletion.mockRejectedValueOnce(new Error('429 slow down'));
    const r = await runCritique(req());
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/critic unavailable/);
  });

  it('degrades to a note when an openai-compat provider has no key', async () => {
    getCriticProviderId.mockReturnValue('openrouter');
    getProviderKey.mockResolvedValueOnce(null);
    const r = await runCritique(req());
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/no OpenRouter key/i);
  });
});
