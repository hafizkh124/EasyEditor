/**
 * M9 Phase C (ADR-0031) / M10 Phase 2.5.1 — the pure Gemini HTTP client, moved
 * out of electron/ai/geminiClient.ts so the web BYOK path (Phase 2.5,
 * agent-model edge function) can call Gemini directly with a user's stored
 * key, sharing the exact same request-building/error-mapping code the
 * desktop BYOK path already uses — not a second implementation to keep in
 * sync by hand.
 *
 * The one thing that differs by platform is WHERE the key comes from:
 * desktop resolves it from `electron/ai/keyStore.ts`'s OS-keychain-backed
 * store and passes it in; the web path will resolve it from the encrypted
 * `user_provider_keys` row server-side. Every function here takes `apiKey`
 * as an explicit parameter for exactly that reason — this file never reads
 * or stores a key itself.
 *
 * Pure — no fetch wrapper, no logger, no Electron/Node global. `console.warn`
 * is used directly for the one warning below since `console` exists in every
 * runtime this file needs to run in (Node, Deno, the browser).
 */
import { EMBED_MODEL, EMBED_DIMS } from './embedConstants.js';

export interface GeminiGenerateRequest {
  model?: string;
  prompt: string;
  systemInstruction?: string;
  temperature?: number;
  maxTokens?: number;
}

export function redactKeyFromLog(message: string, key?: string | null): string {
  let result = message;
  if (key) {
    result = result.split(key).join('AIzaSy***REDACTED***');
  }
  // Generic pattern matching for Gemini keys (AIzaSy...)
  return result.replace(/AIzaSy[A-Za-z0-9_-]{33}/g, 'AIzaSy***REDACTED***');
}

export class ByokApiError extends Error {
  public statusCode: number;
  public failureKind: 'invalid_key' | 'quota_exceeded' | 'rate_limit' | 'unknown';

  constructor(
    message: string,
    statusCode: number,
    failureKind: 'invalid_key' | 'quota_exceeded' | 'rate_limit' | 'unknown',
  ) {
    super(message);
    this.name = 'ByokApiError';
    this.statusCode = statusCode;
    this.failureKind = failureKind;
  }
}

function parseGeminiError(status: number, responseText: string): ByokApiError {
  const lower = responseText.toLowerCase();

  // 401/403 — یا 400 صرف اُس صورت جب Google صراحتاً key کو رد کرے
  if (status === 401 || status === 403 ||
      lower.includes('api_key_invalid') || lower.includes('api key not valid')) {
    return new ByokApiError('آپ کی Gemini key قبول نہیں ہوئی — Settings میں کلید دوبارہ درج کریں۔', status, 'invalid_key');
  }

  // 402 اور quota والا 429 — دونوں بل/کوٹے کا مسئلہ ہیں
  if (status === 402 || (status === 429 && (lower.includes('quota') || lower.includes('exceeded')))) {
    return new ByokApiError('آپ کے Gemini اکاؤنٹ کا کوٹا ختم ہو چکا ہے — Google پر بلنگ یا حد چیک کریں۔', status, 'quota_exceeded');
  }

  if (status === 429) {
    return new ByokApiError('درخواستیں بہت تیز جا رہی ہیں — چند لمحے رک کر دوبارہ کوشش کریں۔', status, 'rate_limit');
  }

  if (status === 400) {
    return new ByokApiError(`درخواست قبول نہیں ہوئی (400): ${responseText.slice(0, 150)}`, status, 'unknown');
  }

  return new ByokApiError(`Gemini API Error (${status}): ${responseText.slice(0, 150)}`, status, 'unknown');
}

/** Executes a low-cost test call to verify a given Gemini API key. */
export async function testGeminiKey(key: string): Promise<{ success: boolean; message: string }> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Hello' }] }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      const parsedErr = parseGeminiError(response.status, errText);
      return { success: false, message: parsedErr.message };
    }

    return { success: true, message: 'Gemini Key کام کر رہی ہے' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: redactKeyFromLog(msg, key) };
  }
}

/** Invokes Gemini text generation with streaming support. */
export async function generateContentStream(
  req: GeminiGenerateRequest & { apiKey: string },
  onChunk?: (chunk: string) => void,
): Promise<string> {
  const model = req.model || 'gemini-2.5-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;

  const bodyPayload: Record<string, unknown> = {
    contents: [{ parts: [{ text: req.prompt }] }],
  };

  if (req.systemInstruction) {
    bodyPayload.systemInstruction = {
      parts: [{ text: req.systemInstruction }],
    };
  }

  if (req.temperature !== undefined || req.maxTokens !== undefined) {
    bodyPayload.generationConfig = {
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.maxTokens !== undefined ? { maxOutputTokens: req.maxTokens } : {}),
    };
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': req.apiKey },
    body: JSON.stringify(bodyPayload),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw parseGeminiError(response.status, errText);
  }

  if (!response.body) {
    throw new Error('No response body returned from Gemini stream');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let fullText = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const jsonStr = trimmed.slice(6);
      if (jsonStr === '[DONE]') continue;

      try {
        const parsed = JSON.parse(jsonStr);
        const textChunk = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (textChunk) {
          fullText += textChunk;
          onChunk?.(textChunk);
        }
      } catch {
        // Continue parsing subsequent lines
      }
    }
  }

  return fullText;
}

/** Embeds text using gemini-embedding-001 (768 dims). */
export async function embedTextContent(text: string, apiKey: string): Promise<number[]> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text }] },
      outputDimensionality: EMBED_DIMS,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw parseGeminiError(response.status, errText);
  }

  const result = (await response.json()) as { embedding?: { values?: number[] } };
  const values = result?.embedding?.values;
  if (!Array.isArray(values) || values.length !== EMBED_DIMS) {
    throw new Error(`Unexpected embedding output shape: expected ${EMBED_DIMS}-float array, got ${values?.length}`);
  }

  return values;
}
