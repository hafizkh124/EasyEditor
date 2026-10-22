ALTER TABLE public.research_sessions
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS research_sessions_user_project_idx
  ON public.research_sessions (user_id, project_id, updated_at DESC);