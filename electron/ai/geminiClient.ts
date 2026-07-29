import { getDecryptedGeminiKey } from './keyStore.js';

export interface GeminiGenerateRequest {
  model?: string;
  prompt: string;
  systemInstruction?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface GeminiEmbedRequest {
  model?: string;
  text: string;
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

  if (status === 400 || status === 401 || status === 403 || lower.includes('api_key_invalid') || lower.includes('invalid api key')) {
    return new ByokApiError('آپ کی key قبول نہیں ہوئی — برائے کرم کلید کی تصدیق کریں', status, 'invalid_key');
  }

  if (status === 429) {
    if (lower.includes('quota') || lower.includes('exceeded')) {
      return new ByokApiError('آپ کی Gemini quota ختم ہو چکی — کوٹا یا بلنگ چیک کریں', status, 'quota_exceeded');
    }
    return new ByokApiError('بہت تیز درخواستیں — چند لمحے رکیں', status, 'rate_limit');
  }

  return new ByokApiError(`Gemini API Error (${status}): ${responseText.slice(0, 150)}`, status, 'unknown');
}

/**
 * Executes a low-cost test call to verify a given or stored Gemini API key.
 */
export async function testGeminiKey(testKey?: string): Promise<{ success: boolean; message: string }> {
  const key = testKey || (await getDecryptedGeminiKey());
  if (!key) {
    return { success: false, message: 'کوئی Gemini key دستیاب نہیں ہے' };
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

/**
 * Invokes Gemini text generation with streaming support.
 */
export async function generateContentStream(
  req: GeminiGenerateRequest,
  onChunk: (chunk: string) => void,
): Promise<string> {
  const key = await getDecryptedGeminiKey();
  if (!key) {
    throw new ByokApiError('کوئی Gemini key پاس نہیں کی گئی — Settings میں اپنی کلید درج کریں', 401, 'invalid_key');
  }

  const model = req.model || 'gemini-2.5-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`;

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
    headers: { 'Content-Type': 'application/json' },
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
          onChunk(textChunk);
        }
      } catch {
        // Continue parsing subsequent lines
      }
    }
  }

  return fullText;
}

/**
 * Embeds text using gemini-embedding-001 (768 dims).
 */
export async function embedTextContent(text: string): Promise<number[]> {
  const key = await getDecryptedGeminiKey();
  if (!key) {
    throw new ByokApiError('کوئی Gemini key پاس نہیں کی گئی — Settings میں اپنی کلید درج کریں', 401, 'invalid_key');
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${encodeURIComponent(key)}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'models/gemini-embedding-001',
      content: { parts: [{ text }] },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw parseGeminiError(response.status, errText);
  }

  const result = (await response.json()) as { embedding?: { values?: number[] } };
  const values = result?.embedding?.values;
  if (!Array.isArray(values) || values.length !== 768) {
    throw new Error(`Unexpected embedding output shape: expected 768 float array, got ${values?.length}`);
  }

  return values;
}
