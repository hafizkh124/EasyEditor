/**
 * M9 Phase C (ADR-0031) — routes the agent to the active provider's models.
 *
 * `resolveAgentModel()` — the ModelFn + bound-call fn for the agentic loop and
 *   playbook bind steps (`toolModel`).
 * `generateAgentText()` — plain text generation for draft_section / run_task /
 *   index extraction (`textModel`).
 *
 * Gemini keeps its existing code paths untouched; an openai-compat provider
 * routes through electron/agent/openAiCompatTools.ts + the shared client.
 * claim-check stays on Gemini for now (JSON-mode output varies by provider).
 */
import { getActiveProviderId, resolveProvider } from '../ai/providerConfig.js';
import { getProviderKey } from '../ai/keyStore.js';
import { generateContentStream, testGeminiKey, ByokApiError } from '../ai/geminiClient.js';
import { chatCompletion } from '../ai/openAiCompatibleClient.js';
import { PROVIDERS, type ProviderId } from '../../shared/agent/providers.js';
import { generateWithTools, generateBoundCall } from './geminiTools.js';
import { makeOpenAiCompatModel } from './openAiCompatTools.js';
import type { ProviderSpec } from '../../shared/agent/providers.js';
import type { AgentMessage, AgentTool, ModelStep } from '../../shared/agent/types.js';

/** A cheap round-trip to check a key works for `providerId`. */
export async function testProviderKey(providerId: ProviderId, key: string): Promise<{ success: boolean; message: string }> {
  const provider = resolveProvider(providerId);
  if (provider.kind === 'gemini') return testGeminiKey(key);
  try {
    await chatCompletion({
      baseUrl: provider.baseUrl,
      apiKey: key,
      model: provider.toolModel,
      maxTokens: 4,
      messages: [{ role: 'user', content: 'Hi' }],
      ...(provider.id === 'openrouter' ? { extraHeaders: { 'HTTP-Referer': 'https://easyeditor.app', 'X-Title': 'EasyEditor' } } : {}),
    });
    return { success: true, message: `${provider.label} key کام کر رہی ہے` };
  } catch (err) {
    return { success: false, message: err instanceof ByokApiError ? err.message : (err as Error).message };
  }
}

export { PROVIDERS };

export interface AgentModel {
  provider: ProviderSpec;
  generate: (messages: AgentMessage[], tools: AgentTool[], systemPrompt: string) => Promise<ModelStep>;
  generateBound: (messages: AgentMessage[], tool: AgentTool, systemPrompt: string) => Promise<{ name: string; args: Record<string, unknown> }>;
}

export async function resolveAgentModel(): Promise<AgentModel> {
  const provider = resolveProvider(getActiveProviderId());

  if (provider.kind === 'gemini') {
    return {
      provider,
      generate: (m, t, s) => generateWithTools(m, t, s),
      generateBound: (m, t, s) => generateBoundCall(m, t, s),
    };
  }

  const key = await getProviderKey(provider.id);
  if (!key) {
    throw new Error(`${provider.label} is the active model provider but no key is set — add one in Settings, or switch back to Gemini.`);
  }
  const model = makeOpenAiCompatModel(provider, key);
  return { provider, generate: model.generate, generateBound: model.generateBound };
}

export interface AgentTextRequest {
  prompt: string;
  systemInstruction?: string;
  temperature?: number;
  maxTokens?: number;
}

export async function generateAgentText(req: AgentTextRequest): Promise<string> {
  const provider = resolveProvider(getActiveProviderId());

  if (provider.kind === 'gemini') {
    return (await generateContentStream({
      model: provider.textModel,
      prompt: req.prompt,
      systemInstruction: req.systemInstruction,
      temperature: req.temperature,
      maxTokens: req.maxTokens,
    })).trim();
  }

  const key = await getProviderKey(provider.id);
  if (!key) {
    throw new Error(`${provider.label} is the active model provider but no key is set — add one in Settings, or switch back to Gemini.`);
  }
  const msg = await chatCompletion({
    baseUrl: provider.baseUrl,
    apiKey: key,
    model: provider.textModel,
    temperature: req.temperature ?? 0.2,
    maxTokens: req.maxTokens,
    messages: [
      ...(req.systemInstruction ? [{ role: 'system' as const, content: req.systemInstruction }] : []),
      { role: 'user' as const, content: req.prompt },
    ],
    ...(provider.id === 'openrouter' ? { extraHeaders: { 'HTTP-Referer': 'https://easyeditor.app', 'X-Title': 'EasyEditor' } } : {}),
  });
  return (msg.content ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}
