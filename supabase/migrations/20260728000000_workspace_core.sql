-- Easy Editor 2.0 — Milestone 1 Core Workspace Migration
-- Creates canonical document model, projects, versions, library items, annotations, and task runs.

-- 1. Projects table
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'general' CHECK (kind IN ('research', 'book', 'translation', 'general')),
  status TEXT NOT NULL DEFAULT 'active',
  genre TEXT,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Documents table (canonical document model: content_json = Tiptap JSON, plain_text = search/RAG)
CREATE TABLE IF NOT EXISTS public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled Document',
  doc_type TEXT NOT NULL DEFAULT 'prose',
  content_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  plain_text TEXT NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'final', 'archived')),
  word_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Document Versions table
CREATE TABLE IF NOT EXISTS public.document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  content_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  plain_text TEXT NOT NULL DEFAULT '',
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Library Items table
CREATE TABLE IF NOT EXISTS public.library_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('book', 'pdf', 'audio', 'ocr', 'reference', 'note')),
  title TEXT NOT NULL,
  source_ref JSONB DEFAULT '{}'::jsonb,
  storage_path TEXT,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Annotations table
CREATE TABLE IF NOT EXISTS public.annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  anchor JSONB NOT NULL DEFAULT '{}'::jsonb,
  note TEXT NOT NULL,
  color TEXT DEFAULT 'yellow',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Task Runs table (Trust UI foundation for level 1/2 AI actions)
CREATE TABLE IF NOT EXISTS public.task_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  task_slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  input JSONB DEFAULT '{}'::jsonb,
  output JSONB DEFAULT '{}'::jsonb,
  sources JSONB DEFAULT '[]'::jsonb,
  confidence NUMERIC(4,3),
  model TEXT,
  tokens_spent INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_documents_project_sort ON public.documents(project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_documents_user_updated ON public.documents(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_versions_doc_created ON public.document_versions(document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_library_items_user ON public.library_items(user_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_user_created ON public.task_runs(user_id, created_at DESC);

-- Additive FK linkages to existing tables (nullable)
ALTER TABLE IF EXISTS public.book_projects
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.translation_projects
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL;

-- Link a migrated section to its canonical document. The section keeps its own
-- `content` (HTML) column untouched, so the migration stays reversible; this
-- column is also what makes migrateBookSectionsToDocuments() skip work it has
-- already done instead of creating duplicate documents on every run.
ALTER TABLE IF EXISTS public.book_sections
  ADD COLUMN IF NOT EXISTS document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_book_sections_document ON public.book_sections(document_id);

-- Enable RLS
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_runs ENABLE ROW LEVEL SECURITY;

-- Owner-only policies (idempotent)
DROP POLICY IF EXISTS "Users manage their own projects" ON public.projects;
CREATE POLICY "Users manage their own projects"
  ON public.projects FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage their own documents" ON public.documents;
CREATE POLICY "Users manage their own documents"
  ON public.documents FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users access versions of their documents" ON public.document_versions;
CREATE POLICY "Users access versions of their documents"
  ON public.document_versions FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.documents d WHERE d.id = document_versions.document_id AND d.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Users manage their own library items" ON public.library_items;
CREATE POLICY "Users manage their own library items"
  ON public.library_items FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage annotations on their documents" ON public.annotations;
CREATE POLICY "Users manage annotations on their documents"
  ON public.annotations FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users access their task runs" ON public.task_runs;
CREATE POLICY "Users access their task runs"
  ON public.task_runs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Automatic updated_at trigger helper
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_projects_updated_at ON public.projects;
CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS update_documents_updated_at ON public.documents;
CREATE TRIGGER update_documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
