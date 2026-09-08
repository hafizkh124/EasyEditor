/**
 * M9 Phase C (ADR-0031) / M10 Phase 2.5.1 — thin wrapper.
 *
 * The pure HTTP client moved to shared/ai/geminiClient.ts so the web BYOK
 * path (Phase 2.5, agent-model edge function) can call Gemini directly with
 * a user's stored key, sharing the exact same code. This file now only owns
 * what stays genuinely desktop-only: resolving the key from the OS-keychain-
 * backed store (keyStore.ts) before calling through.
 */
import { getDecryptedGeminiKey } from './keyStore.js';
import {
  ByokApiError, redactKeyFromLog, testGeminiKey as testGeminiKeyShared,
  generateContentStream as generateContentStreamShared,
  embedTextContent as embedTextContentShared,
  type GeminiGenerateRequest,
} from '../../shared/ai/geminiClient.js';

export { ByokApiError, redactKeyFromLog, type GeminiGenerateRequest };

export interface GeminiEmbedRequest {
  model?: string;
  text: string;
}

/** Executes a low-cost test call to verify a given or stored Gemini API key. */
export async function testGeminiKey(testKey?: string): Promise<{ success: boolean; message: string }> {
  const key = testKey || (await getDecryptedGeminiKey());
  if (!key) {
    return { success: false, message: 'کوئی Gemini key دستیاب نہیں ہے' };
  }
  return testGeminiKeyShared(key);
}

/** Invokes Gemini text generation with streaming support. */
export async function generateContentStream(
  req: GeminiGenerateRequest,
  onChunk?: (chunk: string) => void,
): Promise<string> {
  const key = await getDecryptedGeminiKey();
  if (!key) {
    throw new ByokApiError('کوئی Gemini key پاس نہیں کی گئی — Settings میں اپنی کلید درج کریں', 401, 'invalid_key');
  }
  return generateContentStreamShared({ ...req, apiKey: key }, onChunk);
}

/** Embeds text using gemini-embedding-001 (768 dims). */
export async function embedTextContent(text: string): Promise<number[]> {
  const key = await getDecryptedGeminiKey();
  if (!key) {
    throw new ByokApiError('کوئی Gemini key پاس نہیں کی گئی — Settings میں اپنی کلید درج کریں', 401, 'invalid_key');
  }
  return embedTextContentShared(text, key);
}
