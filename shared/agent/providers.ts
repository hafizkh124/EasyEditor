/**
 * M9 Phase C (ADR-0031) — the model-provider registry.
 *
 * Pure and static. One entry per provider the desktop agent can run on. The
 * agent's whole value is citation integrity, so a provider is NOT selectable
 * until it clears the Phase B eval (`baseline.json`) — the registry only
 * describes it.
 *
 * `kind`:
 *  - 'gemini'        — Google's own wire format (electron/agent/geminiTools.ts).
 *  - 'openai-compat' — the OpenAI /chat/completions shape, shared by Groq and
 *                      OpenRouter (electron/agent/openAiCompatTools.ts).
 *
 * Model roles:
 *  - `toolModel` drives the agentic loop and playbook bind calls — it MUST do
 *    function calling well. Reasoning models are deliberately NOT used here
 *    (ADR-0029/§4: their `tool_choice` forcing is unreliable).
 *  - `textModel` runs draft_section / run_task / index extraction / claim-check.
 *  - `reasoningModel` is offered only as a CRITIC (a later slice), never as a
 *    tool driver.
 *
 * Model ids drift fast; the electron side (electron/ai/providerConfig.ts) lets
 * each be overridden with an env var so a stale id never needs a code change.
 */

export type ProviderId = 'gemini' | 'groq' | 'openrouter';
export type ProviderKind = 'gemini' | 'openai-compat';

export interface ProviderSpec {
  id: ProviderId;
  label: string;
  kind: ProviderKind;
  /** Base URL for an openai-compat provider's `/chat/completions`. Empty for gemini (endpoints are per-call). */
  baseUrl: string;
  /** Hostname for the agent outbound allowlist (electron/lib/agentModelAllowlist.ts). */
  host: string;
  /** One-click "get a key" deep link. */
  getKeyUrl: string;
  /** Clipboard auto-detect pattern for a pasted key. */
  keyPattern: RegExp;
  /** Env var holding the key in a headless / eval context. */
  keyEnvVar: string;
  toolModel: string;
  textModel: string;
  reasoningModel?: string;
  /** true ⇒ a usable free tier exists (shown in the UI; never depended on). */
  freeTier: boolean;
  /**
   * A privacy caveat the scholar must see BEFORE enabling — e.g. an endpoint
   * that would carry unpublished manuscript text through a jurisdiction they
   * may not intend. Absent ⇒ the standard "your text goes to this provider".
   */
  privacyNote?: string;
}

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    kind: 'gemini',
    baseUrl: '',
    host: 'generativelanguage.googleapis.com',
    getKeyUrl: 'https://aistudio.google.com/apikey',
    keyPattern: /\bAIzaSy[A-Za-z0-9_-]{20,}\b/,
    keyEnvVar: 'GEMINI_API_KEY',
    toolModel: 'gemini-2.5-flash',
    textModel: 'gemini-2.5-flash',
    freeTier: true,
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    kind: 'openai-compat',
    baseUrl: 'https://api.groq.com/openai/v1',
    host: 'api.groq.com',
    getKeyUrl: 'https://console.groq.com/keys',
    keyPattern: /\bgsk_[A-Za-z0-9]{20,}\b/,
    keyEnvVar: 'GROQ_API_KEY',
    // Groq's lineup churns — override with GROQ_TOOL_MODEL / _TEXT_MODEL /
    // _REASONING_MODEL. gpt-oss-20b clears the loop eval on the FREE tier
    // (78% pass, 100% citation-resolve, 0 violations, 2026-09-06); a paid tier
    // should set GROQ_TOOL_MODEL=openai/gpt-oss-120b for stronger tool choice.
    // Qwen 3.x is kept for Arabic/Urdu prose and as the reasoning critic.
    toolModel: 'openai/gpt-oss-20b',
    textModel: 'openai/gpt-oss-20b',
    reasoningModel: 'qwen/qwen3.8-27b',
    freeTier: true,
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai-compat',
    baseUrl: 'https://openrouter.ai/api/v1',
    host: 'openrouter.ai',
    getKeyUrl: 'https://openrouter.ai/keys',
    keyPattern: /\bsk-or-v1-[A-Za-z0-9]{20,}\b/,
    keyEnvVar: 'OPENROUTER_API_KEY',
    toolModel: 'google/gemini-2.5-flash',
    textModel: 'google/gemini-2.5-flash',
    reasoningModel: 'deepseek/deepseek-r1',
    freeTier: false,
    privacyNote:
      'OpenRouter routes each request to a third-party host you pick per model. A model such as deepseek/deepseek-r1 runs on infrastructure outside the EU/US — do not select it for unpublished manuscript text unless you accept that.',
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];
export const DEFAULT_PROVIDER: ProviderId = 'gemini';

export function isProviderId(v: unknown): v is ProviderId {
  return typeof v === 'string' && (PROVIDER_IDS as string[]).includes(v);
}

export function getProvider(id: string | null | undefined): ProviderSpec {
  return isProviderId(id) ? PROVIDERS[id] : PROVIDERS[DEFAULT_PROVIDER];
}
