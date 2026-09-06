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
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${req.apiKey}`, ...req.extraHeaders },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(redactKeyFromLog(err instanceof Error ? err.message : String(err), req.apiKey));
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    log.warn('chat completion failed', { status: res.status, model: req.model });
    throw parseError(res.status, text, new URL(url).hostname);
  }

  const data = await res.json() as { choices?: Array<{ message?: OpenAiResponseMessage }> };
  const message = data.choices?.[0]?.message;
  if (!message) throw new ByokApiError('provider returned no message', 502, 'unknown');
  return message;
}
