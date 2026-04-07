-- ================================================================
-- Migration: research_sessions — persisted Islamic/General research sessions
-- ================================================================

CREATE TABLE IF NOT EXISTS public.research_sessions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title            TEXT,
  messages         JSONB       NOT NULL DEFAULT '[]',
  selected_domains TEXT[]      NOT NULL DEFAULT '{}',
  citations        JSONB       NOT NULL DEFAULT '[]',
  mode             TEXT        NOT NULL DEFAULT 'general',  -- 'general' | 'islamic'
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.research_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "research_sessions_users_own"
  ON public.research_sessions
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS research_sessions_user_id_idx
  ON public.research_sessions (user_id, updated_at DESC);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION public.touch_research_session()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER research_sessions_updated_at
  BEFORE UPDATE ON public.research_sessions
  FOR EACH ROW EXECUTE FUNCTION public.touch_research_session();
