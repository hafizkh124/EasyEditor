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
 *
 * `checkClaim()` — the lightweight JSON classification behind insert_footnote's
 *   claim check. Follows the LOOP provider (whatever drives the citations
 *   verifies them; it is always eval-verified) but uses its fast `textModel`.
 */
import { getActiveProviderId, getTextProviderId, resolveProvider } from '../ai/providerConfig.js';
import { getProviderKey } from '../ai/keyStore.js';
import { generateContentStream, testGeminiKey, ByokApiError } from '../ai/geminiClient.js';
import { chatCompletion } from '../ai/openAiCompatibleClient.js';
import { PROVIDERS, type ProviderId } from '../../shared/agent/providers.js';
import { generateWithTools, generateBoundCall } from './geminiTools.js';
import { makeOpenAiCompatModel } from './openAiCompatTools.js';
import { logger } from '../lib/logger.js';
import type { ProviderSpec } from '../../shared/agent/providers.js';
import type { AgentMessage, AgentTool, ModelStep } from '../../shared/agent/types.js';
import type { ClaimVerdict } from '../../shared/agent/grounding.js';

const log = logger.child('agent/modelRouter');

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
  const provider = resolveProvider(getTextProviderId());

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

// ── claim check (insert_footnote's second tier) ────────────────────────────

const CLAIM_PROMPT = (claim: string, excerpt: string): string =>
  'You are checking whether a source supports a claim in a scholarly document.\n\n' +
  `CLAIM: ${claim.slice(0, 600)}\n\n` +
  `SOURCE EXCERPT: ${excerpt.slice(0, 2000)}\n\n` +
  'Answer with ONLY a compact JSON object: {"supports": true|false, "note": "<=15 words"}. ' +
  '"supports" is true only if the excerpt directly backs the claim; false if it is off-topic, ' +
  'contradicts it, or is too vague to support it.';

function parseVerdict(text: string): ClaimVerdict {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  const parsed = JSON.parse(s === -1 ? text : text.slice(s, e + 1)) as { supports?: unknown; note?: unknown };
  return {
    supports: parsed.supports !== false,
    note: typeof parsed.note === 'string' ? parsed.note.slice(0, 120) : '',
  };
}

/**
 * ONE lightweight JSON call on the LOOP provider's fast model. Non-fatal: any
 * model/network/parse failure degrades to "no opinion" (supports:true) so a
 * transient error never blocks a footnote whose deterministic gate already
 * passed (SPEC-M8, ADR-0019 item 6).
 */
export async function checkClaim(claim: string, excerpt: string): Promise<ClaimVerdict> {
  const provider = resolveProvider(getActiveProviderId());
  try {
    if (provider.kind === 'gemini') {
      const key = await getProviderKey('gemini');
      if (!key) return { supports: true, note: 'claim not checked (no API key)' };
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${provider.textModel}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            contents: [{ parts: [{ text: CLAIM_PROMPT(claim, excerpt) }] }],
            generationConfig: { temperature: 0, responseMimeType: 'application/json' },
          }),
        },
      );
      if (!res.ok) throw new Error(`Gemini ${res.status}`);
      const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      return parseVerdict(data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '');
    }

    const key = await getProviderKey(provider.id);
    if (!key) return { supports: true, note: `claim not checked (no ${provider.label} key)` };
    const msg = await chatCompletion({
      baseUrl: provider.baseUrl,
      apiKey: key,
      model: provider.textModel,
      temperature: 0,
      responseFormat: 'json_object',
      messages: [{ role: 'user', content: CLAIM_PROMPT(claim, excerpt) }],
      ...(provider.id === 'openrouter' ? { extraHeaders: { 'HTTP-Referer': 'https://easyeditor.app', 'X-Title': 'EasyEditor' } } : {}),
    });
    return parseVerdict((msg.content ?? '').replace(/<think>[\s\S]*?<\/think>/gi, ''));
  } catch (err) {
    log.warn('claim check failed — not blocking the footnote', { provider: provider.id, message: (err as Error).message });
    return { supports: true, note: 'claim check unavailable' };
  }
}
