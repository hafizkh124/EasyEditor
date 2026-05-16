-- Phase C: Referral system.
-- Every user gets a unique referral code on profile insert. New signups can
-- carry a `?ref=<code>` URL param which the client writes into profiles.referred_by.
-- When admin approves a referred user, the referrer earns credits.

-- 1. Schema ────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referral_credits INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_profiles_referral_code
  ON public.profiles(referral_code)
  WHERE referral_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_referred_by
  ON public.profiles(referred_by)
  WHERE referred_by IS NOT NULL;

-- 2. Referral events audit trail ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referral_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referee_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credits_granted INTEGER NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (referrer_id, referee_id)  -- one grant per referrer/referee pair, ever
);

ALTER TABLE public.referral_events ENABLE ROW LEVEL SECURITY;

-- Referrer can see their own grants. Admin can see all.
DROP POLICY IF EXISTS "referral_events_select_own" ON public.referral_events;
CREATE POLICY "referral_events_select_own" ON public.referral_events
  FOR SELECT USING (
    auth.uid() = referrer_id
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- 3. Auto-generate referral_code on profile insert ─────────────────────────
-- 8-char alphanumeric code. Retries on the unlikely UNIQUE collision.
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS TRIGGER AS $$
DECLARE
  candidate TEXT;
  exists_count INT;
  attempts INT := 0;
BEGIN
  IF NEW.referral_code IS NOT NULL THEN
    RETURN NEW;  -- caller already set one
  END IF;

  LOOP
    candidate := upper(substring(
      regexp_replace(encode(gen_random_bytes(8), 'base64'), '[^A-Za-z0-9]', '', 'g'),
      1, 8
    ));
    EXIT WHEN length(candidate) = 8;
    attempts := attempts + 1;
    IF attempts > 10 THEN
      -- Fallback: use first 8 hex chars of a uuid
      candidate := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      EXIT;
    END IF;
  END LOOP;

  -- Collision check
  SELECT count(*) INTO exists_count FROM public.profiles WHERE referral_code = candidate;
  WHILE exists_count > 0 AND attempts < 20 LOOP
    candidate := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    SELECT count(*) INTO exists_count FROM public.profiles WHERE referral_code = candidate;
    attempts := attempts + 1;
  END LOOP;

  NEW.referral_code := candidate;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS profiles_generate_referral_code ON public.profiles;
CREATE TRIGGER profiles_generate_referral_code
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.generate_referral_code();

-- 4. Backfill codes for existing profiles ──────────────────────────────────
-- Loop so each row gets a fresh candidate (the UPDATE doesn't fire the BEFORE
-- INSERT trigger).
DO $$
DECLARE
  r RECORD;
  candidate TEXT;
BEGIN
  FOR r IN SELECT user_id FROM public.profiles WHERE referral_code IS NULL LOOP
    LOOP
      candidate := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = candidate);
    END LOOP;
    UPDATE public.profiles SET referral_code = candidate WHERE user_id = r.user_id;
  END LOOP;
END $$;
