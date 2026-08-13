-- Link a legacy translation project to the document it was migrated into.
--
-- `book_sections` already carries `document_id`, which is what makes the book
-- migration re-runnable: a section with a document is skipped. Translation
-- projects had no equivalent, so `backfillTranslationProjects()` could only
-- link the project shell — the chunks themselves (source_text, translated_text,
-- notes) had no migration path at all and would have been stranded when
-- /translate-workspace is retired.
--
-- One document per project rather than one per chunk: a translation project is
-- a book split into paragraphs, and the chunks are only meaningful in order and
-- next to their source. Splitting them into hundreds of documents would lose
-- exactly the pairing that makes them useful.

ALTER TABLE public.translation_projects
  ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL;

-- Migration reads filter on this to find unmigrated projects.
CREATE INDEX IF NOT EXISTS translation_projects_document_id_idx
  ON public.translation_projects (document_id)
  WHERE document_id IS NULL;

COMMENT ON COLUMN public.translation_projects.document_id IS
  'Document this legacy project was migrated into. NULL = not yet migrated. Mirrors book_sections.document_id.';
