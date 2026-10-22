-- ================================================================
-- Migration: translation review (SYSTEM-2026 §6)
--
--   * translation_projects.glossary — fixed renderings for terms
--     ([{ "source": "صلاة", "target": "Salah" }, ...]) sent with every page
--     so a whole book translates them the same way, and offered to the
--     user's next translation.
--   * translation_projects.style — 'idiomatic' (default) or 'literal'.
--   * translation_chunks.reviewed — which paragraph pairs of a page the
--     user has marked reviewed, for the review progress.
--
-- Nullable/defaulted and additive. The client retries without these
-- columns when they are missing, so it works before this migration runs.
-- ================================================================

ALTER TABLE public.translation_projects
  ADD COLUMN IF NOT EXISTS glossary JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS style TEXT NOT NULL DEFAULT 'idiomatic'
    CHECK (style IN ('idiomatic', 'literal'));

ALTER TABLE public.translation_chunks
  ADD COLUMN IF NOT EXISTS reviewed INTEGER[] NOT NULL DEFAULT '{}';
