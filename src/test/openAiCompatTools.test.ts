// @vitest-environment node
// electron/agent/openAiCompatTools.ts (M9 Phase C, ADR-0031) — the OpenAI
// wire-format mapping. This is the whole risk of adding a non-Gemini provider
// (blueprint §4), so it is pinned hard.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentMessage, AgentTool } from '../../shared/agent/types';
import { PROVIDERS } from '../../shared/agent/providers';

const chatCompletion = vi.fn();
vi.mock('../../electron/ai/openAiCompatibleClient.ts', () => ({ chatCompletion }));

let mod: typeof import('../../electron/agent/openAiCompatTools');
beforeEach(async () => {
  vi.clearAllMocks();
  mod = await import('../../electron/agent/openAiCompatTools');
});

const TOOLS: AgentTool[] = [
  {
    name: 'search_corpus',
    description: 'search',
    params: { query: { type: 'string', description: 'q' }, limit: { type: 'number', description: 'n' } },
    required: ['query'],
    effect: 'read',
  },
  {
    name: 'ask_clarifying_question',
    description: 'ask one question',
    params: { question: { type: 'string', description: 'q' } },
    required: ['question'],
    effect: 'read',
  },
];

describe('toOpenAiTools', () => {
  it('emits lowercase JSON-Schema types, required, and additionalProperties:false', () => {
    const [t] = mod.toOpenAiTools(TOOLS);
    expect(t.type).toBe('function');
    expect(t.function.parameters).toMatchObject({
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'number' } },
      required: ['query'],
      additionalProperties: false,
    });
  });
});

describe('toOpenAiMessages', () => {
  it('maps the AgentMessage stream to OpenAI roles and pairs tool results by id', () => {
    const stream: AgentMessage[] = [
      { role: 'user', text: 'cite the hadith' },
      { role: 'model', toolCall: { name: 'search_corpus', args: { query: 'niyyah' } } },
      { role: 'tool', name: 'search_corpus', result: { results: [{ id: 'c1' }] } },
      { role: 'model', text: 'done' },
    ];
    const out = mod.toOpenAiMessages('SYS', stream);
    expect(out[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(out[1]).toEqual({ role: 'user', content: 'cite the hadith' });
    expect(out[2].role).toBe('assistant');
    expect(out[2].tool_calls?.[0]).toMatchObject({ type: 'function', function: { name: 'search_corpus' } });
    const callId = out[2].tool_calls![0].id;
    expect(out[3]).toEqual({ role: 'tool', tool_call_id: callId, content: JSON.stringify({ results: [{ id: 'c1' }] }) });
    expect(out[4]).toEqual({ role: 'assistant', content: 'done' });
  });
});

describe('makeOpenAiCompatModel.generate', () => {
  const model = () => mod.makeOpenAiCompatModel(PROVIDERS.groq, 'gsk_test');

  it('returns a toolCall step from a tool_calls response', async () => {
    chatCompletion.mockResolvedValueOnce({ role: 'assistant', content: null, tool_calls: [{ id: 'call_0', type: 'function', function: { name: 'search_corpus', arguments: '{"query":"x"}' } }] });
    const step = await model().generate([{ role: 'user', text: 'go' }], TOOLS, 'SYS');
    expect(step).toEqual({ kind: 'toolCall', name: 'search_corpus', args: { query: 'x' } });
  });

  it('turns an ask_clarifying_question call into a clarify step', async () => {
    chatCompletion.mockResolvedValueOnce({ role: 'assistant', content: null, tool_calls: [{ id: 'call_0', type: 'function', function: { name: 'ask_clarifying_question', arguments: '{"question":"which chapter?"}' } }] });
    const step = await model().generate([{ role: 'user', text: 'go' }], TOOLS, 'SYS');
    expect(step).toEqual({ kind: 'clarify', question: 'which chapter?' });
  });

  it('returns a text step and strips a reasoning <think> block', async () => {
    chatCompletion.mockResolvedValueOnce({ role: 'assistant', content: '<think>hmm let me consider</think>\nThe answer is 42.' });
    const step = await model().generate([{ role: 'user', text: 'go' }], [], 'SYS');
    expect(step).toEqual({ kind: 'text', text: 'The answer is 42.' });
  });

  it('sends tools with tool_choice auto and the provider base URL', async () => {
    chatCompletion.mockResolvedValueOnce({ role: 'assistant', content: 'ok' });
    await model().generate([{ role: 'user', text: 'go' }], TOOLS, 'SYS');
    expect(chatCompletion).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: PROVIDERS.groq.baseUrl,
      model: PROVIDERS.groq.toolModel,
      toolChoice: 'auto',
    }));
  });
});

describe('makeOpenAiCompatModel.generateBound', () => {
  it('forces tool_choice to the one tool and returns its call', async () => {
    chatCompletion.mockResolvedValueOnce({ role: 'assistant', content: null, tool_calls: [{ id: 'call_0', type: 'function', function: { name: 'search_corpus', arguments: '{"query":"niyyah"}' } }] });
    const r = await mod.makeOpenAiCompatModel(PROVIDERS.groq, 'k').generateBound([{ role: 'user', text: 'go' }], TOOLS[0], 'SYS');
    expect(r).toEqual({ name: 'search_corpus', args: { query: 'niyyah' } });
    expect(chatCompletion).toHaveBeenCalledWith(expect.objectContaining({
      toolChoice: { type: 'function', function: { name: 'search_corpus' } },
    }));
  });

  it('throws when the model answers with text instead of the forced call', async () => {
    chatCompletion.mockResolvedValueOnce({ role: 'assistant', content: 'I would rather not.' });
    await expect(mod.makeOpenAiCompatModel(PROVIDERS.groq, 'k').generateBound([{ role: 'user', text: 'go' }], TOOLS[0], 'SYS'))
      .rejects.toThrow(/expected a search_corpus call/);
  });

  it('adds OpenRouter attribution headers only for openrouter', async () => {
    chatCompletion.mockResolvedValue({ role: 'assistant', content: 'ok' });
    await mod.makeOpenAiCompatModel(PROVIDERS.openrouter, 'k').generate([{ role: 'user', text: 'go' }], [], 'S');
    expect(chatCompletion).toHaveBeenLastCalledWith(expect.objectContaining({ extraHeaders: expect.objectContaining({ 'X-Title': 'EasyEditor' }) }));
    await mod.makeOpenAiCompatModel(PROVIDERS.groq, 'k').generate([{ role: 'user', text: 'go' }], [], 'S');
    expect(chatCompletion).toHaveBeenLastCalledWith(expect.objectContaining({ extraHeaders: undefined }));
  });
});
