-- SYSTEM-2026 §3 — a chat belongs to the folder (workspace project) it was
-- started in, so the folder index and the Files page can list its chats.
--
-- Nullable, and cleared when the folder is deleted: a chat started outside
-- any folder, or whose folder is gone, simply has no folder. Existing rows
-- are untouched.
ALTER TABLE public.research_sessions
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS research_sessions_user_project_idx
  ON public.research_sessions (user_id, project_id, updated_at DESC);
