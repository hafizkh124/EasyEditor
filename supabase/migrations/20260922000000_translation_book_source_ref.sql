-- ================================================================
-- Migration: translation_projects.source_ref (Book Translation resume)
--
-- The whole-book translator (`/translate-book`) needs to resume a project
-- without asking the user to re-pick a Shamela book. `translation_projects`
-- had no column that could point back at the source, so this adds one:
--   * 'shamela:<bookId>' for a book picked from Maktaba Shamela — resume
--     re-fetches the book's pages by id, no re-upload needed.
--   * 'pdf' for an uploaded PDF — the browser cannot persist the original
--     file, so resume still needs the user to re-supply it; this marker is
--     just enough to show the right resume prompt.
-- Nullable and additive: existing rows (all from the older Translation
-- Workspace feature, which has no book-source concept) are unaffected.
-- ================================================================

ALTER TABLE public.translation_projects
  ADD COLUMN IF NOT EXISTS source_ref TEXT;
