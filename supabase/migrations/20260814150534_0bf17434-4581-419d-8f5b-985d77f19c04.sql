ALTER TABLE public.translation_projects
  ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS translation_projects_document_id_idx
  ON public.translation_projects (document_id)
  WHERE document_id IS NULL;

COMMENT ON COLUMN public.translation_projects.document_id IS
  'Document this legacy project was migrated into. NULL = not yet migrated. Mirrors book_sections.document_id.';