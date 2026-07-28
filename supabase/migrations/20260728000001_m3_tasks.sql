-- Migration for M3 Pillar A & D (Task Library, ai_tasks, expanded task_runs)

-- 1. Expand task_runs table
ALTER TABLE public.task_runs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.task_runs ADD COLUMN IF NOT EXISTS progress JSONB DEFAULT '{"total":0, "done":0, "failed":0, "skipped":0}'::jsonb;
ALTER TABLE public.task_runs ADD COLUMN IF NOT EXISTS error TEXT;

-- Update status constraint to include 'cancelled' and set default to 'pending'
ALTER TABLE public.task_runs DROP CONSTRAINT IF EXISTS task_runs_status_check;
ALTER TABLE public.task_runs ADD CONSTRAINT task_runs_status_check CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled'));
ALTER TABLE public.task_runs ALTER COLUMN status SET DEFAULT 'pending';

-- Add performance indexes for task_runs
CREATE INDEX IF NOT EXISTS idx_task_runs_doc_created ON public.task_runs(document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_runs_unfinished ON public.task_runs(user_id, created_at DESC) WHERE status IN ('pending', 'running');

-- 2. Create ai_tasks table for user custom tasks
CREATE TABLE IF NOT EXISTS public.ai_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  label TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  base_task_slug TEXT, -- Reference to built-in task slug in client registry
  scope TEXT NOT NULL DEFAULT 'either' CHECK (scope IN ('selection', 'document', 'either')),
  apply_mode TEXT NOT NULL DEFAULT 'inline' CHECK (apply_mode IN ('inline', 'block', 'append', 'replace_document')),
  output_format TEXT NOT NULL DEFAULT 'text' CHECK (output_format IN ('text', 'html')),
  chunkable BOOLEAN NOT NULL DEFAULT true,
  produces_sources BOOLEAN NOT NULL DEFAULT false,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_tasks_user_slug_unique UNIQUE (user_id, slug)
);

ALTER TABLE public.ai_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users access own tasks" ON public.ai_tasks;
CREATE POLICY "Users access own tasks" ON public.ai_tasks
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3. Add handle_updated_at triggers
DROP TRIGGER IF EXISTS update_task_runs_modtime ON public.task_runs;
CREATE TRIGGER update_task_runs_modtime
  BEFORE UPDATE ON public.task_runs
  FOR EACH ROW EXECUTE PROCEDURE handle_updated_at();

DROP TRIGGER IF EXISTS update_ai_tasks_modtime ON public.ai_tasks;
CREATE TRIGGER update_ai_tasks_modtime
  BEFORE UPDATE ON public.ai_tasks
  FOR EACH ROW EXECUTE PROCEDURE handle_updated_at();
