-- Phase 2: unified per-section session history (SPEC v2 §5.3)
-- Replaces the section-specific research_sessions table with a generic table
-- keyed by (user_id, section). Existing research_sessions rows are migrated
-- in a later step (separate migration) to keep this change reversible.

CREATE TABLE IF NOT EXISTS public.user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  section text NOT NULL CHECK (section IN ('transcribe','speak','ocr','research')),
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS user_sessions_user_section_updated_idx
  ON public.user_sessions (user_id, section, updated_at DESC);

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner read"   ON public.user_sessions;
DROP POLICY IF EXISTS "owner write"  ON public.user_sessions;
DROP POLICY IF EXISTS "owner update" ON public.user_sessions;
DROP POLICY IF EXISTS "owner delete" ON public.user_sessions;

CREATE POLICY "owner read"   ON public.user_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "owner write"  ON public.user_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner update" ON public.user_sessions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "owner delete" ON public.user_sessions FOR DELETE USING (auth.uid() = user_id);

-- Trigger: keep updated_at fresh on any row mutation.
CREATE OR REPLACE FUNCTION public.touch_user_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_sessions_touch_updated_at ON public.user_sessions;
CREATE TRIGGER user_sessions_touch_updated_at
  BEFORE UPDATE ON public.user_sessions
  FOR EACH ROW EXECUTE FUNCTION public.touch_user_sessions_updated_at();
