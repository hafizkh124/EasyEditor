/**
 * M9 Phase C (ADR-0031) / M10 Phase 2.5.1 — thin re-export.
 *
 * The pure HTTP client moved to shared/ai/openAiCompatClient.ts so the web
 * BYOK path (Phase 2.5, agent-model edge function) can call Groq/OpenRouter
 * directly with a user's stored key, sharing the exact same code. Nothing in
 * this file was genuinely Electron-bound — kept only so
 * electron/agent/openAiCompatTools.ts and its tests keep importing from the
 * same path they always have.
 */
export {
  chatCompletion,
  type ChatCompletionRequest,
  type OpenAiToolSchema, type OpenAiMessage, type OpenAiResponseMessage,
} from '../../shared/ai/openAiCompatClient.js';
