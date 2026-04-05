
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cloned_voice_id text DEFAULT NULL;
