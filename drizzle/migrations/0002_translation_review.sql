ALTER TABLE public.translation_projects
  ADD COLUMN IF NOT EXISTS glossary JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS style TEXT NOT NULL DEFAULT 'idiomatic'
    CHECK (style IN ('idiomatic', 'literal'));

ALTER TABLE public.translation_chunks
  ADD COLUMN IF NOT EXISTS reviewed INTEGER[] NOT NULL DEFAULT '{}';