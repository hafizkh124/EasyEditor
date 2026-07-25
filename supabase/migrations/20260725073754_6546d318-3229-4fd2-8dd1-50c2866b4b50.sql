ALTER TABLE public.passage_translations ADD COLUMN IF NOT EXISTS is_cached BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.passage_translations ALTER COLUMN is_verified SET DEFAULT false;

CREATE TABLE IF NOT EXISTS public.translation_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source_lang TEXT NOT NULL DEFAULT 'ar',
  target_lang TEXT NOT NULL DEFAULT 'ur',
  genre TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.translation_projects TO authenticated;
GRANT ALL ON public.translation_projects TO service_role;
ALTER TABLE public.translation_projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "translation_projects_select_owner" ON public.translation_projects;
CREATE POLICY "translation_projects_select_owner" ON public.translation_projects FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "translation_projects_insert_owner" ON public.translation_projects;
CREATE POLICY "translation_projects_insert_owner" ON public.translation_projects FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "translation_projects_update_owner" ON public.translation_projects;
CREATE POLICY "translation_projects_update_owner" ON public.translation_projects FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "translation_projects_delete_owner" ON public.translation_projects;
CREATE POLICY "translation_projects_delete_owner" ON public.translation_projects FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.translation_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.translation_projects(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL DEFAULT 1,
  source_text TEXT NOT NULL,
  translated_text TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  passage_key TEXT,
  tm_match_score NUMERIC(4,3) DEFAULT 0,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT translation_chunks_project_index UNIQUE(project_id, chunk_index)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.translation_chunks TO authenticated;
GRANT ALL ON public.translation_chunks TO service_role;
ALTER TABLE public.translation_chunks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "translation_chunks_owner_all" ON public.translation_chunks;
CREATE POLICY "translation_chunks_owner_all" ON public.translation_chunks FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.translation_projects p WHERE p.id = translation_chunks.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.translation_projects p WHERE p.id = translation_chunks.project_id AND p.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.book_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  subtitle TEXT,
  genre TEXT NOT NULL DEFAULT 'general',
  abstract TEXT,
  status TEXT NOT NULL DEFAULT 'idea',
  target_word_count INT DEFAULT 10000,
  current_word_count INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.book_projects TO authenticated;
GRANT ALL ON public.book_projects TO service_role;
ALTER TABLE public.book_projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "book_projects_owner_select" ON public.book_projects;
CREATE POLICY "book_projects_owner_select" ON public.book_projects FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "book_projects_owner_insert" ON public.book_projects;
CREATE POLICY "book_projects_owner_insert" ON public.book_projects FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "book_projects_owner_update" ON public.book_projects;
CREATE POLICY "book_projects_owner_update" ON public.book_projects FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "book_projects_owner_delete" ON public.book_projects;
CREATE POLICY "book_projects_owner_delete" ON public.book_projects FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.book_chapters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.book_projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  chapter_number INT NOT NULL DEFAULT 1,
  synopsis TEXT,
  status TEXT NOT NULL DEFAULT 'outline',
  sort_order INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT book_chapters_project_number UNIQUE(project_id, chapter_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.book_chapters TO authenticated;
GRANT ALL ON public.book_chapters TO service_role;
ALTER TABLE public.book_chapters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "book_chapters_owner_all" ON public.book_chapters;
CREATE POLICY "book_chapters_owner_all" ON public.book_chapters FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.book_projects p WHERE p.id = book_chapters.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.book_projects p WHERE p.id = book_chapters.project_id AND p.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.book_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id UUID NOT NULL REFERENCES public.book_chapters(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  section_number INT NOT NULL DEFAULT 1,
  content TEXT DEFAULT '',
  synopsis TEXT,
  status TEXT NOT NULL DEFAULT 'idea',
  sort_order INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.book_sections TO authenticated;
GRANT ALL ON public.book_sections TO service_role;
ALTER TABLE public.book_sections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "book_sections_owner_all" ON public.book_sections;
CREATE POLICY "book_sections_owner_all" ON public.book_sections FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.book_chapters c JOIN public.book_projects p ON p.id = c.project_id WHERE c.id = book_sections.chapter_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.book_chapters c JOIN public.book_projects p ON p.id = c.project_id WHERE c.id = book_sections.chapter_id AND p.user_id = auth.uid()));