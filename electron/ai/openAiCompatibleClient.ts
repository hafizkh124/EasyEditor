/**
 * M9 Phase C (ADR-0031) — a minimal OpenAI `/chat/completions` client.
 *
 * Shared by every `kind: 'openai-compat'` provider (Groq, OpenRouter). It does
 * the HTTP + error mapping only; the AgentMessage ⇄ OpenAI wire-format mapping
 * and the ModelStep contract live in electron/agent/openAiCompatTools.ts.
 *
 * Non-streaming: the agent loop emits its own per-step progress and a
 * function-call response has nothing useful to stream.
 */
import { ByokApiError, redactKeyFromLog } from './geminiClient.js';
import { assertAllowedModelUrl } from '../lib/agentModelAllowlist.js';
import { logger } from '../lib/logger.js';

const log = logger.child('ai/openai-compat');

export interface OpenAiToolSchema {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
}

export interface OpenAiResponseMessage {
  role: string;
  content: string | null;
  reasoning_content?: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
}

export interface ChatCompletionRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: OpenAiMessage[];
  tools?: OpenAiToolSchema[];
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  temperature?: number;
  maxTokens?: number;
  /** 'json_object' asks the provider to emit strict JSON (used by the claim check). */
  responseFormat?: 'json_object';
  extraHeaders?: Record<string, string>;
}

function parseError(status: number, body: string, label: string): ByokApiError {
  const lower = body.toLowerCase();
  if (status === 401 || status === 403 || lower.includes('invalid api key') || lower.includes('invalid_api_key')) {
    return new ByokApiError(`${label} کی key قبول نہیں ہوئی — Settings میں دوبارہ درج کریں۔`, status, 'invalid_key');
  }
  if (status === 402 || (status === 429 && (lower.includes('quota') || lower.includes('credit') || lower.includes('insufficient')))) {
    return new ByokApiError(`${label} اکاؤنٹ کا کوٹا/کریڈٹ ختم ہو چکا ہے۔`, status, 'quota_exceeded');
  }
  if (status === 429) {
    return new ByokApiError('درخواستیں بہت تیز جا رہی ہیں — چند لمحے رک کر دوبارہ کوشش کریں۔', status, 'rate_limit');
  }
  return new ByokApiError(`${label} API Error (${status}): ${body.slice(0, 180)}`, status, 'unknown');
}

export async function chatCompletion(req: ChatCompletionRequest): Promise<OpenAiResponseMessage> {
  const url = `${req.baseUrl.replace(/\/$/, '')}/chat/completions`;
  assertAllowedModelUrl(url);

  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    temperature: req.temperature ?? 0.2,
    ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
    ...(req.tools?.length ? { tools: req.tools, tool_choice: req.toolChoice ?? 'auto' } : {}),
    ...(req.responseFormat ? { response_format: { type: req.responseFormat } } : {}),
  };

  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${req.apiKey}`, ...req.extraHeaders },
    body: JSON.stringify(body),
  };
  const host = new URL(url).hostname;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Retry a transport failure ("fetch failed" hides its cause) and a 429
  // (Groq's free tier is TPM-limited; it sends `retry-after`). Up to 3 tries.
  let res: Response | null = null;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const r = await fetch(url, init);
      if (r.status === 429 && attempt < 2) {
        const after = Number(r.headers.get('retry-after')) || 0;
        await sleep(after > 0 ? Math.min(after * 1000, 20_000) : 1500 * (attempt + 1));
        continue;
      }
      res = r;
      break;
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await sleep(400 * (attempt + 1));
    }
  }
  if (!res) {
    const e = lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    const cause = (e as { cause?: unknown }).cause;
    const detail = cause instanceof Error ? `: ${cause.message}` : cause ? `: ${String(cause)}` : '';
    throw new Error(redactKeyFromLog(`could not reach ${host} — ${e.message}${detail}`, req.apiKey));
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    log.warn('chat completion failed', { status: res.status, model: req.model });
    throw parseError(res.status, text, host);
  }

  const data = await res.json() as { choices?: Array<{ message?: OpenAiResponseMessage }> };
  const message = data.choices?.[0]?.message;
  if (!message) throw new ByokApiError('provider returned no message', 502, 'unknown');
  return message;
}
