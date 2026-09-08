// M10 Phase 2.5 — the model-provider registry, Deno side.
//
// A small, deliberate copy of shared/agent/providers.ts's essential fields
// (id/label/baseUrl/host/toolModel), not a cross-boundary import — edge
// functions in this repo are self-contained by established convention
// (tafsir-proxy's own header comment: "no import from src/ or electron/"),
// and no function has verified that a relative import escaping
// supabase/functions/ into the top-level shared/ tree survives Lovable's
// deploy packaging. Keep this in sync by hand if a provider or model changes
// — shared by both byok-keys (save/status/delete/test) and agent-model
// (BYOK routing).
export type ProviderId = "gemini" | "groq" | "openrouter";

export interface ProviderSpec {
  label: string;
  kind: "gemini" | "openai-compat";
  baseUrl: string;
  host: string;
  toolModel: string;
}

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  gemini: {
    label: "Google Gemini",
    kind: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    host: "generativelanguage.googleapis.com",
    toolModel: "gemini-2.5-flash",
  },
  groq: {
    label: "Groq",
    kind: "openai-compat",
    baseUrl: "https://api.groq.com/openai/v1",
    host: "api.groq.com",
    toolModel: "openai/gpt-oss-20b",
  },
  openrouter: {
    label: "OpenRouter",
    kind: "openai-compat",
    baseUrl: "https://openrouter.ai/api/v1",
    host: "openrouter.ai",
    toolModel: "google/gemini-2.5-flash",
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function isProviderId(v: unknown): v is ProviderId {
  return typeof v === "string" && (PROVIDER_IDS as string[]).includes(v);
}
