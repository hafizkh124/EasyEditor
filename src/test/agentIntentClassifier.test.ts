// @vitest-environment node
// electron/agent/intentClassifier.ts — the Level-2 (one cached LLM call)
// refinement. Never throws; a failure returns the heuristic flagged degraded.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createElectronMock } from './helpers/electronMock';
import type { IntentResult } from '../../shared/agent/intent';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-intent-'));
const electron = createElectronMock();
electron.app.getPath = vi.fn(() => tmp);
vi.mock('electron', () => electron);

vi.mock('../../electron/ai/providerConfig.ts', () => ({
  getActiveProviderId: () => 'gemini',
  resolveProvider: () => ({ id: 'gemini', kind: 'gemini', textModel: 'gemini-2.5-flash' }),
}));
const keyStore = { getProviderKey: vi.fn(async (): Promise<string | null> => 'fake-key') };
vi.mock('../../electron/ai/keyStore.ts', () => keyStore);
vi.mock('../../electron/ai/openAiCompatibleClient.ts', () => ({ chatCompletion: vi.fn() }));

const HEURISTIC: IntentResult = { route: { kind: 'open' }, ambiguous: true, matchedDomains: [] };
const CTX = { connectorsOn: ['tafsir', 'hadith'] };

let classifyIntentLLM: typeof import('../../electron/agent/intentClassifier.ts').classifyIntentLLM;

beforeAll(async () => {
  ({ classifyIntentLLM } = await import('../../electron/agent/intentClassifier.ts'));
});

beforeEach(() => {
  vi.clearAllMocks();
  keyStore.getProviderKey.mockResolvedValue('fake-key');
  try { fs.rmSync(path.join(tmp, 'intent-cache.json')); } catch { /* none */ }
});

afterAll(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } });

function mockGemini(json: unknown) {
  const body = { candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }] };
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
}

describe('classifyIntentLLM', () => {
  it('refines an ambiguous verdict from a valid model response', async () => {
    const f = mockGemini({ route: 'gated', connectors: ['tafsir'], reason: 'quranic' });
    const r = await classifyIntentLLM('اس آیت اور حدیث کے بارے میں', CTX, HEURISTIC);
    expect(r.route).toEqual({ kind: 'gated', connectors: ['tafsir'] });
    expect(f).toHaveBeenCalledOnce();
  });

  it('a second identical call is served from the cache (no fetch)', async () => {
    mockGemini({ route: 'direct', connectors: [] });
    await classifyIntentLLM('same question', CTX, HEURISTIC);
    const f2 = vi.spyOn(globalThis, 'fetch');
    f2.mockClear();
    const r = await classifyIntentLLM('same question', CTX, HEURISTIC);
    expect(r.route.kind).toBe('direct');
    expect(f2).not.toHaveBeenCalled();
  });

  it('a thrown fetch → the heuristic, flagged degraded (never throws)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    const r = await classifyIntentLLM('unique ask A', CTX, HEURISTIC);
    expect(r.route).toEqual(HEURISTIC.route);
    expect(r.degraded).toBe(true);
  });

  it('no API key → the heuristic, degraded', async () => {
    keyStore.getProviderKey.mockResolvedValue(null);
    const r = await classifyIntentLLM('unique ask B', CTX, HEURISTIC);
    expect(r.degraded).toBe(true);
  });

  it('a garbage model response → the heuristic, degraded', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'not json at all' }] } }] }), { status: 200 }),
    );
    const r = await classifyIntentLLM('unique ask C', CTX, HEURISTIC);
    expect(r.degraded).toBe(true);
  });
});
