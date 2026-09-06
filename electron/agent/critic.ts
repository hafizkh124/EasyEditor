/**
 * M9 Phase C/E — the reasoning-model CRITIC.
 *
 * §4 of the blueprint review: a reasoning model (DeepSeek-R1, Qwen 3) forces
 * tool calls poorly but critiques rigorously. So it never drives the loop — it
 * is handed a finished plan / draft / takhrīj as plain text and asked to
 * scrutinise it. Output is advisory (an artifact or a margin comment), never an
 * edit. Non-fatal: a missing key or a provider error degrades to a short note.
 *
 * Uses the `critic` provider (electron/ai/providerConfig.ts), and that
 * provider's `reasoningModel` when it has one, else its `textModel`.
 */
import { getCriticProviderId, resolveProvider } from '../ai/providerConfig.js';
import { getProviderKey } from '../ai/keyStore.js';
import { generateContentStream } from '../ai/geminiClient.js';
import { chatCompletion } from '../ai/openAiCompatibleClient.js';
import { logger } from '../lib/logger.js';
import {
  buildCritiqueInstruction, buildCritiqueInput, type CritiqueKind,
} from '../../shared/ai/prompts/critique.js';

const log = logger.child('agent/critic');

const MAX_SUBJECT_CHARS = 9000;
const MAX_CRITIQUE_CHARS = 4000;

export interface CritiqueRequest {
  kind: CritiqueKind;
  /** The plan / draft / takhrīj text to scrutinise. */
  subject: string;
  /** Optional — the original ask, chapter context, etc. */
  context?: string;
  /** Optional — the source excerpts the work rests on (for kind 'draft'). */
  sources?: string;
  /** Optional — what the author most wants scrutinised. */
  focus?: string;
}

export interface CritiqueResult {
  ok: boolean;
  /** The critique prose, or a short note when it could not run. */
  text: string;
  /** Which model produced it, for the transcript. */
  model?: string;
}

const stripThink = (t: string): string => t.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

export async function runCritique(req: CritiqueRequest): Promise<CritiqueResult> {
  const provider = resolveProvider(getCriticProviderId());
  const model = provider.reasoningModel ?? provider.textModel;
  const systemInstruction = buildCritiqueInstruction(req.kind, req.focus);
  const input = buildCritiqueInput({
    subject: req.subject.slice(0, MAX_SUBJECT_CHARS),
    context: req.context?.slice(0, 2000),
    sources: req.sources?.slice(0, 4000),
  });

  try {
    let raw: string;
    if (provider.kind === 'gemini') {
      raw = await generateContentStream({ model, prompt: input, systemInstruction, temperature: 0.3 });
    } else {
      const key = await getProviderKey(provider.id);
      if (!key) return { ok: false, text: `(critic unavailable — no ${provider.label} key set)` };
      const msg = await chatCompletion({
        baseUrl: provider.baseUrl,
        apiKey: key,
        model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: input },
        ],
        ...(provider.id === 'openrouter' ? { extraHeaders: { 'HTTP-Referer': 'https://easyeditor.app', 'X-Title': 'EasyEditor' } } : {}),
      });
      raw = msg.content ?? '';
    }
    const text = stripThink(raw).slice(0, MAX_CRITIQUE_CHARS).trim();
    return text
      ? { ok: true, text, model: `${provider.id}:${model}` }
      : { ok: false, text: '(critic returned nothing)' };
  } catch (err) {
    log.warn('critique failed', { provider: provider.id, message: (err as Error).message });
    return { ok: false, text: `(critic unavailable — ${(err as Error).message})` };
  }
}
