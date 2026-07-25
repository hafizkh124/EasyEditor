-- =============================================================================
-- Al-Ulama Easy Editor — CONSOLIDATED DEPLOY BUNDLE (2026-07-25)
--
-- Paste this whole file into the Supabase SQL editor and run it once.
--
-- It applies the end state of these six migrations in the correct order:
--   20260725000000_passage_translations
--   20260725100000_fix_translators_alquran
--   20260725200000_classical_scope
--   20260725300000_hadith_translators
--   20260725400000_translation_and_book_workspaces
--   20260725500000_update_translator_defaults
--
-- WHY A BUNDLE RATHER THAN RUNNING THE SIX FILES:
--   1. `CREATE POLICY` has no `IF NOT EXISTS` in Postgres. Re-running any of
--      those migrations after a partial failure aborts with "policy already
--      exists". Here every policy is dropped-then-created, so the whole file
--      is safe to run again as many times as needed.
--   2. Migration 20260725100000 begins with `DELETE FROM public.translators`.
--      Run out of order (or re-run later) that also wipes the hadith
--      translators added by 20260725300000, breaking /extract for hadith.
--      This bundle upserts instead of deleting, so order and re-runs are safe.
--
-- It runs inside a single transaction: if anything fails, nothing is applied.
-- Verification queries are at the bottom (run them after the COMMIT).
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. scholarly_documents: passage_key (canonical passage identity)
-- =============================================================================
ALTER TABLE public.scholarly_documents
  ADD COLUMN IF NOT EXISTS passage_key TEXT;

CREATE INDEX IF NOT EXISTS scholarly_documents_passage_key_idx
  ON public.scholarly_documents (passage_key);

-- Backfill Quran rows: quran:{surah}:{ayah}
UPDATE public.scholarly_documents
SET passage_key = 'quran:' || (citation_ref->>'surah_number') || ':' || (citation_ref->>'verse')
WHERE passage_key IS NULL
  AND (citation_ref->>'surah_number') IS NOT NULL
  AND (citation_ref->>'verse') IS NOT NULL;

-- Backfill Hadith rows: hadith:{collection}:{number}
UPDATE public.scholarly_documents
SET passage_key = 'hadith:' || LOWER(COALESCE(citation_ref->>'collection', citation_ref->>'book', 'hadith'))
                  || ':' || (citation_ref->>'hadith_number')
WHERE passage_key IS NULL
  AND (citation_ref->>'hadith_number') IS NOT NULL;

-- Tier-2 classical corpus is scoped by discipline; index that JSON field.
CREATE INDEX IF NOT EXISTS scholarly_documents_discipline_idx
  ON public.scholarly_documents ((citation_ref->>'discipline'));


-- =============================================================================
-- 2. translators registry
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.translators (
  slug                 TEXT PRIMARY KEY,
  full_name            TEXT NOT NULL,
  language             TEXT NOT NULL,                    -- 'ur' | 'en' | 'fa' | 'ar'
  corpus_type          TEXT NOT NULL DEFAULT 'quran',    -- 'quran' | 'hadith' | 'general'
  maslak               TEXT,
  authority_note       TEXT,
  source               TEXT NOT NULL,                    -- 'alquran.cloud' | 'hadithapi' | 'manual'
  external_edition_id  TEXT,
  is_enabled           BOOLEAN NOT NULL DEFAULT true,
  sort_order           INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.translators ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "translators_select_authenticated" ON public.translators;
CREATE POLICY "translators_select_authenticated"
  ON public.translators FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "translators_service_role_all" ON public.translators;
CREATE POLICY "translators_service_role_all"
  ON public.translators FOR ALL TO service_role
  USING (true) WITH CHECK (true);


-- =============================================================================
-- 3. passage_translations cache
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.passage_translations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passage_key     TEXT NOT NULL,
  translator_slug TEXT NOT NULL REFERENCES public.translators(slug) ON DELETE CASCADE,
  language        TEXT NOT NULL,
  text            TEXT NOT NULL,
  source_url      TEXT,
  is_verified     BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT passage_translations_unique_key_translator UNIQUE (passage_key, translator_slug)
);

-- `is_verified` means "checked by a scholar". Text fetched from an API is only
-- cached, never verified — so the default is false and `is_cached` records how
-- it got here. (The original migration defaulted is_verified to true.)
ALTER TABLE public.passage_translations
  ADD COLUMN IF NOT EXISTS is_cached BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.passage_translations
  ALTER COLUMN is_verified SET DEFAULT false;

CREATE INDEX IF NOT EXISTS passage_translations_passage_key_idx
  ON public.passage_translations (passage_key);

CREATE INDEX IF NOT EXISTS passage_translations_translator_slug_idx
  ON public.passage_translations (translator_slug);

ALTER TABLE public.passage_translations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "passage_translations_select_authenticated" ON public.passage_translations;
CREATE POLICY "passage_translations_select_authenticated"
  ON public.passage_translations FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "passage_translations_service_role_all" ON public.passage_translations;
CREATE POLICY "passage_translations_service_role_all"
  ON public.passage_translations FOR ALL TO service_role
  USING (true) WITH CHECK (true);


-- =============================================================================
-- 4. RPC: get_passage_translations
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_passage_translations(
  p_passage_key TEXT,
  p_slugs TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  passage_key     TEXT,
  translator_slug TEXT,
  full_name       TEXT,
  language        TEXT,
  maslak          TEXT,
  text            TEXT,
  source_url      TEXT,
  is_verified     BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    pt.passage_key, pt.translator_slug, t.full_name, pt.language,
    t.maslak, pt.text, pt.source_url, pt.is_verified
  FROM public.passage_translations pt
  JOIN public.translators t ON t.slug = pt.translator_slug
  WHERE pt.passage_key = p_passage_key
    AND (p_slugs IS NULL OR pt.translator_slug = ANY(p_slugs))
  ORDER BY t.sort_order ASC, t.slug ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_passage_translations(TEXT, TEXT[]) TO authenticated;


-- =============================================================================
-- 5. Seed translators (UPSERT — never deletes, so re-runs are safe)
--
-- Quran: slug == the alquran.cloud edition identifier, each one verified
-- present in GET https://api.alquran.cloud/v1/edition?type=translation.
-- Translators with no alquran.cloud edition (Taqi Usmani's Aasaan Tarjuma,
-- Khattab's Clear Quran) are deliberately NOT seeded — a dead edition id
-- would fetch nothing and show up as a broken translator in /extract.
-- =============================================================================
INSERT INTO public.translators
  (slug, full_name, language, corpus_type, maslak, source, external_edition_id, is_enabled, sort_order)
VALUES
  -- Urdu
  ('ur.jalandhry',  'مولانا فتح محمد جالندھری',                'ur', 'quran', 'سلیس و عام فہم',           'alquran.cloud', 'ur.jalandhry',  true, 1),
  ('ur.junagarhi',  'مولانا محمد جوناگڑھی',                    'ur', 'quran', 'اہلِ حدیث / سلیس اسلوب',   'alquran.cloud', 'ur.junagarhi',  true, 2),
  ('ur.kanzuliman', 'امام احمد رضا خان (کنز الایمان)',          'ur', 'quran', 'بریلوی / باادب اسلوب',     'alquran.cloud', 'ur.kanzuliman', true, 3),
  ('ur.maududi',    'مولانا ابوالاعلیٰ مودودی (تفہیم القرآن)', 'ur', 'quran', 'فکری و ادبی اسلوب',        'alquran.cloud', 'ur.maududi',    true, 4),
  ('ur.qadri',      'ڈاکٹر طاہر القادری (عرفان القرآن)',        'ur', 'quran', 'بریلوی / بامحاورہ اسلوب',  'alquran.cloud', 'ur.qadri',      true, 5),
  ('ur.jawadi',     'علامہ ذیشان حیدر جوادی',                  'ur', 'quran', 'اہلِ تشیع',                'alquran.cloud', 'ur.jawadi',     false, 99),
  -- English
  ('en.sahih',      'Saheeh International',                     'en', 'quran', 'General / Modern English', 'alquran.cloud', 'en.sahih',      true, 10),
  ('en.yusufali',   'Abdullah Yusuf Ali',                      'en', 'quran', 'Classic English',          'alquran.cloud', 'en.yusufali',   true, 11),
  ('en.pickthall',  'Marmaduke Pickthall',                     'en', 'quran', 'Classic English',          'alquran.cloud', 'en.pickthall',  true, 12),
  -- Farsi
  ('fa.makarem',    'ناصر مکارم شیرازی',                        'fa', 'quran', 'فارسی',                    'alquran.cloud', 'fa.makarem',    true, 20),
  ('fa.ansarian',   'حسین انصاریان',                            'fa', 'quran', 'فارسی',                    'alquran.cloud', 'fa.ansarian',   true, 21),
  -- Hadith (HadithAPI returns one record carrying ar/ur/en; external_edition_id
  -- is the response FIELD the edge function reads for that language).
  ('hadith.ar',     'عربی متن (HadithAPI)',                     'ar', 'hadith', NULL, 'hadithapi', 'hadithArabic',  true, 28),
  ('hadith.ur',     'اردو ترجمہ (HadithAPI)',                   'ur', 'hadith', NULL, 'hadithapi', 'hadithUrdu',    true, 29),
  ('hadith.en',     'English (HadithAPI)',                      'en', 'hadith', NULL, 'hadithapi', 'hadithEnglish', true, 30)
ON CONFLICT (slug) DO UPDATE SET
  full_name           = EXCLUDED.full_name,
  language            = EXCLUDED.language,
  corpus_type         = EXCLUDED.corpus_type,
  maslak              = EXCLUDED.maslak,
  source              = EXCLUDED.source,
  external_edition_id = EXCLUDED.external_edition_id,
  is_enabled          = EXCLUDED.is_enabled,
  sort_order          = EXCLUDED.sort_order;


-- =============================================================================
-- 6. RPC: search_classical_scoped (Tier-2 lexical channel)
--
-- Mirrors search_documents_scoped's diacritic-tolerant content_ar matching,
-- but scopes by citation_ref->>'discipline' and returns passage_key so the
-- engine can build a stable match_key. Returns no rows until the classical
-- corpus is ingested — safe to create now.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.search_classical_scoped(
  p_patterns    text[],
  p_disciplines text[] DEFAULT NULL,
  p_limit       int    DEFAULT 30
)
RETURNS TABLE (
  id           uuid,
  domain       text,
  source_type  text,
  content      text,
  content_ar   text,
  citation_ref jsonb,
  language     text,
  source_url   text,
  passage_key  text,
  match_score  integer
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS $$
DECLARE
  v_pattern       text;
  v_norm_patterns text[] := ARRAY[]::text[];
BEGIN
  FOREACH v_pattern IN ARRAY p_patterns LOOP
    IF v_pattern IS NOT NULL AND length(btrim(v_pattern)) >= 2 THEN
      v_norm_patterns := array_append(v_norm_patterns, public.normalize_arabic_text(v_pattern));
    END IF;
  END LOOP;

  IF array_length(v_norm_patterns, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    sd.id, sd.domain, sd.source_type, sd.content, sd.content_ar, sd.citation_ref,
    sd.language, sd.source_url, sd.passage_key,
    (
      SELECT count(*)::int
      FROM unnest(v_norm_patterns) AS t(term)
      WHERE public.normalize_arabic_text(sd.content_ar) ILIKE '%' || t.term || '%'
    ) AS match_score
  FROM public.scholarly_documents sd
  WHERE
    sd.content_ar IS NOT NULL
    AND (p_disciplines IS NULL OR (sd.citation_ref->>'discipline') = ANY(p_disciplines))
    AND EXISTS (
      SELECT 1 FROM unnest(v_norm_patterns) AS t(term)
      WHERE public.normalize_arabic_text(sd.content_ar) ILIKE '%' || t.term || '%'
    )
  ORDER BY match_score DESC, sd.id
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_classical_scoped(text[], text[], int)
  TO authenticated, anon, service_role;


-- =============================================================================
-- 7. Translation workspace (Phase 5)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.translation_projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  source_lang TEXT NOT NULL DEFAULT 'ar',
  target_lang TEXT NOT NULL DEFAULT 'ur',
  genre       TEXT NOT NULL DEFAULT 'general',  -- general|tafsir|fiqh|hadith|lughat|fatwa
  status      TEXT NOT NULL DEFAULT 'draft',    -- draft|in_progress|completed
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.translation_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "translation_projects_select_owner" ON public.translation_projects;
CREATE POLICY "translation_projects_select_owner"
  ON public.translation_projects FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "translation_projects_insert_owner" ON public.translation_projects;
CREATE POLICY "translation_projects_insert_owner"
  ON public.translation_projects FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "translation_projects_update_owner" ON public.translation_projects;
CREATE POLICY "translation_projects_update_owner"
  ON public.translation_projects FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "translation_projects_delete_owner" ON public.translation_projects;
CREATE POLICY "translation_projects_delete_owner"
  ON public.translation_projects FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.translation_chunks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES public.translation_projects(id) ON DELETE CASCADE,
  chunk_index     INT NOT NULL DEFAULT 1,
  source_text     TEXT NOT NULL,
  translated_text TEXT DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'draft',  -- draft|review|completed
  passage_key     TEXT,
  tm_match_score  NUMERIC(4,3) DEFAULT 0,
  notes           TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT translation_chunks_project_index UNIQUE(project_id, chunk_index)
);

-- Translation Memory looks chunks up by exact source text.
CREATE INDEX IF NOT EXISTS translation_chunks_source_text_idx
  ON public.translation_chunks (source_text);

ALTER TABLE public.translation_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "translation_chunks_owner_all" ON public.translation_chunks;
CREATE POLICY "translation_chunks_owner_all"
  ON public.translation_chunks FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.translation_projects p
            WHERE p.id = translation_chunks.project_id AND p.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.translation_projects p
            WHERE p.id = translation_chunks.project_id AND p.user_id = auth.uid())
  );


-- =============================================================================
-- 8. Book authoring workspace (Phase 6)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.book_projects (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  subtitle           TEXT,
  genre              TEXT NOT NULL DEFAULT 'general',  -- fiqh|hadith|tafsir|seerah|research|general
  abstract           TEXT,
  status             TEXT NOT NULL DEFAULT 'idea',     -- idea|outline|draft|review|final
  target_word_count  INT DEFAULT 10000,
  current_word_count INT DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.book_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "book_projects_owner_select" ON public.book_projects;
CREATE POLICY "book_projects_owner_select"
  ON public.book_projects FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "book_projects_owner_insert" ON public.book_projects;
CREATE POLICY "book_projects_owner_insert"
  ON public.book_projects FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "book_projects_owner_update" ON public.book_projects;
CREATE POLICY "book_projects_owner_update"
  ON public.book_projects FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "book_projects_owner_delete" ON public.book_projects;
CREATE POLICY "book_projects_owner_delete"
  ON public.book_projects FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.book_chapters (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES public.book_projects(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  chapter_number INT NOT NULL DEFAULT 1,
  synopsis       TEXT,
  status         TEXT NOT NULL DEFAULT 'outline',  -- outline|draft|review|completed
  sort_order     INT NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT book_chapters_project_number UNIQUE(project_id, chapter_number)
);

ALTER TABLE public.book_chapters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "book_chapters_owner_all" ON public.book_chapters;
CREATE POLICY "book_chapters_owner_all"
  ON public.book_chapters FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.book_projects p
            WHERE p.id = book_chapters.project_id AND p.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.book_projects p
            WHERE p.id = book_chapters.project_id AND p.user_id = auth.uid())
  );

CREATE TABLE IF NOT EXISTS public.book_sections (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id     UUID NOT NULL REFERENCES public.book_chapters(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  section_number INT NOT NULL DEFAULT 1,
  content        TEXT DEFAULT '',
  synopsis       TEXT,
  status         TEXT NOT NULL DEFAULT 'idea',  -- idea|outline|draft|review|final
  sort_order     INT NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.book_sections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "book_sections_owner_all" ON public.book_sections;
CREATE POLICY "book_sections_owner_all"
  ON public.book_sections FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.book_chapters c
            JOIN public.book_projects p ON p.id = c.project_id
            WHERE c.id = book_sections.chapter_id AND p.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.book_chapters c
            JOIN public.book_projects p ON p.id = c.project_id
            WHERE c.id = book_sections.chapter_id AND p.user_id = auth.uid())
  );

COMMIT;


-- =============================================================================
-- VERIFICATION — run these AFTER the bundle commits.
-- Expected results are noted next to each query.
-- =============================================================================

-- 1) All six new tables/functions exist.
--    Expect 5 rows: book_chapters, book_projects, book_sections,
--    passage_translations, translation_chunks, translation_projects (6).
-- SELECT table_name FROM information_schema.tables
--  WHERE table_schema='public'
--    AND table_name IN ('translators','passage_translations','translation_projects',
--                       'translation_chunks','book_projects','book_chapters','book_sections')
--  ORDER BY table_name;

-- 2) Translator registry — expect 14 rows; ur.jawadi disabled; 3 hadith rows.
-- SELECT slug, language, corpus_type, is_enabled, sort_order
--   FROM public.translators ORDER BY corpus_type, sort_order;

-- 3) passage_key backfill — expect quran ≈ 6236 and a large hadith count,
--    and NO rows where a Quran/Hadith row still has a NULL passage_key.
-- SELECT split_part(passage_key,':',1) AS kind, count(*)
--   FROM public.scholarly_documents WHERE passage_key IS NOT NULL GROUP BY 1;

-- 4) RPCs callable — both should return without error (empty result is fine).
-- SELECT * FROM public.get_passage_translations('quran:2:255', NULL);
-- SELECT * FROM public.search_classical_scoped(ARRAY['صلاة'], ARRAY['fiqh'], 5);

-- 5) RLS is on for every new table — expect all true.
-- SELECT relname, relrowsecurity FROM pg_class
--  WHERE relname IN ('translators','passage_translations','translation_projects',
--                    'translation_chunks','book_projects','book_chapters','book_sections');
