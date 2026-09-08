-- M10 Phase 2.5.2 — Web BYOK key storage (ADR-0036).
--
-- One encrypted key per (user, provider). The key column is never selectable
-- by a client role: RLS is enabled with NO policies for anon/authenticated,
-- so the ONLY way to reach this table at all is a service-role connection —
-- i.e. the byok-keys edge function. There is deliberately no "users manage
-- their own keys" policy here (contrast projects/documents/annotations in
-- 20260728000000_workspace_core.sql) — even a correct owner-only policy
-- would still let an authenticated user SELECT the ciphertext column
-- directly, and Postgres RLS filters rows, not columns.
CREATE TABLE IF NOT EXISTS public.user_provider_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('gemini', 'groq', 'openrouter')),
  -- base64(iv || ciphertext), AES-256-GCM under PROVIDER_KEY_SECRET
  -- (an edge function secret, never checked in) — see byok-keys/index.ts.
  encrypted_key TEXT NOT NULL,
  -- Last 4 characters of the PLAINTEXT key, for display only ("…aB3x") —
  -- never enough to reconstruct the key, so storing it outside the
  -- encrypted column is not a leak.
  last_four TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_user_provider_keys_user ON public.user_provider_keys(user_id);

ALTER TABLE public.user_provider_keys ENABLE ROW LEVEL SECURITY;
-- No CREATE POLICY here — see the table comment above. service_role bypasses
-- RLS entirely (Supabase's standard grant), which is the only role
-- byok-keys/index.ts ever uses to touch this table.
