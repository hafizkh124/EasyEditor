-- M10 Phase 2.5.2 — Web BYOK key storage (ADR-0036).
CREATE TABLE IF NOT EXISTS public.user_provider_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('gemini', 'groq', 'openrouter')),
  encrypted_key TEXT NOT NULL,
  last_four TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

GRANT ALL ON public.user_provider_keys TO service_role;

CREATE INDEX IF NOT EXISTS idx_user_provider_keys_user ON public.user_provider_keys(user_id);

ALTER TABLE public.user_provider_keys ENABLE ROW LEVEL SECURITY;