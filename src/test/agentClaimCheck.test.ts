// @vitest-environment node
// M9 Phase C (ADR-0031) — checkClaim, insert_footnote's second tier, now
// routed through the active provider (electron/agent/modelRouter.ts) instead
// of a hard-wired Gemini endpoint. What must hold: it follows the LOOP
// provider, uses its fast textModel + JSON mode, and NEVER blocks a footnote —
// any failure degrades to supports:true.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PROVIDERS } from '../../shared/agent/providers';

const chatCompletion = vi.fn(async (_r: { model: string; responseFormat?: string; tools?: unknown }) =>
  ({ role: 'assistant', content: '{"supports": false, "note": "excerpt is about wudu, not riba"}' }));
vi.mock('../../electron/ai/openAiCompatibleClient.ts', () => ({ chatCompletion }));

const getProviderKey = vi.fn<(p: string) => Promise<string | null>>(async () => 'k');
vi.mock('../../electron/ai/keyStore.ts', () => ({ getProviderKey }));

const getActiveProviderId = vi.fn<() => 'gemini' | 'groq' | 'openrouter'>(() => 'gemini');
vi.mock('../../electron/ai/providerConfig.ts', async (orig) => ({
  ...(await orig<typeof import('../../electron/ai/providerConfig.ts')>()),
  getActiveProviderId,
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

let checkClaim: typeof import('../../electron/agent/modelRouter').checkClaim;
beforeEach(async () => {
  vi.clearAllMocks();
  getProviderKey.mockResolvedValue('k');
  ({ checkClaim } = await import('../../electron/agent/modelRouter'));
});

describe('checkClaim routing', () => {
  it('gemini loop provider → a JSON-mode generateContent call on the fast text model', async () => {
    getActiveProviderId.mockReturnValue('gemini');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{"supports": true, "note": "directly backs it"}' }] } }] }),
    });
    const v = await checkClaim('riba is prohibited', 'إن الله حرم الربا');
    expect(v).toEqual({ supports: true, note: 'directly backs it' });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain(`/${PROVIDERS.gemini.textModel}:generateContent`);
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it('an openai-compat loop provider → chatCompletion with response_format json_object, no tools', async () => {
    getActiveProviderId.mockReturnValue('groq');
    const v = await checkClaim('X', 'Y');
    expect(v).toEqual({ supports: false, note: 'excerpt is about wudu, not riba' });
    const call = chatCompletion.mock.calls[0][0];
    expect(call.model).toBe(PROVIDERS.groq.textModel);
    expect(call.responseFormat).toBe('json_object');
    expect(call.tools).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('degrades to supports:true on a provider error — never blocks the footnote', async () => {
    getActiveProviderId.mockReturnValue('groq');
    chatCompletion.mockRejectedValueOnce(new Error('429'));
    expect(await checkClaim('X', 'Y')).toEqual({ supports: true, note: 'claim check unavailable' });
  });

  it('degrades to a "not checked" note when the loop provider has no key', async () => {
    getActiveProviderId.mockReturnValue('openrouter');
    getProviderKey.mockResolvedValueOnce(null);
    const v = await checkClaim('X', 'Y');
    expect(v.supports).toBe(true);
    expect(v.note).toMatch(/not checked/);
  });

  it('tolerates prose around the JSON object', async () => {
    getActiveProviderId.mockReturnValue('groq');
    chatCompletion.mockResolvedValueOnce({ role: 'assistant', content: 'Here is my answer:\n{"supports": true, "note": "ok"}\ndone' });
    expect(await checkClaim('X', 'Y')).toEqual({ supports: true, note: 'ok' });
  });
});
