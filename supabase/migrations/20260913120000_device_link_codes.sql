-- Desktop device-link sign-in (RFC 8628-style device authorization grant,
-- adapted to Supabase sessions). The desktop app cannot use the project's
-- Google OAuth provider directly (Lovable's managed broker only covers the
-- web app's own `lovable.auth.signInWithOAuth` flow — see
-- supabase/functions/device-link/index.ts's header comment for the full
-- story). Desktop instead generates a short-lived code, the user confirms it
-- from the already-signed-in web app, and desktop polls for that
-- confirmation to receive a real session.
--
-- No RLS policies, same shape as 20260908000000_user_provider_keys.sql: the
-- table is never read/written by a client role directly, only by the
-- device-link edge function's service-role connection. In particular, an
-- authenticated web user must never be able to SELECT arbitrary rows here —
-- that would let them enumerate other users' pending codes.
CREATE TABLE IF NOT EXISTS public.device_link_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 8-char Crockford base32 (no 0/O/1/I/L ambiguity), unique while live.
  code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'claimed', 'expired')),
  -- NULL until the web app's `confirm` action sets it from the caller's own JWT.
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ
);

-- Only one LIVE row per code — a code is short-lived enough that reusing the
-- text after it expires is fine, so this is partial rather than a plain
-- UNIQUE(code), which would eventually collide as the table grows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_link_codes_code_live
  ON public.device_link_codes(code) WHERE status IN ('pending', 'confirmed');

CREATE INDEX IF NOT EXISTS idx_device_link_codes_expires_at ON public.device_link_codes(expires_at);

ALTER TABLE public.device_link_codes ENABLE ROW LEVEL SECURITY;
-- No CREATE POLICY — see the table comment above. service_role (the
-- device-link edge function) bypasses RLS entirely, which is the only way
-- this table is ever reached.
