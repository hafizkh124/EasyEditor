CREATE TABLE IF NOT EXISTS public.device_link_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'claimed', 'expired')),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ
);
GRANT ALL ON public.device_link_codes TO service_role;
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_link_codes_code_live
  ON public.device_link_codes(code) WHERE status IN ('pending', 'confirmed');
CREATE INDEX IF NOT EXISTS idx_device_link_codes_expires_at ON public.device_link_codes(expires_at);
ALTER TABLE public.device_link_codes ENABLE ROW LEVEL SECURITY;