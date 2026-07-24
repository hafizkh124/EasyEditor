-- ================================================================
-- Migration: passage_translations & translators registry
-- Phase 1 of Al-Ulama Easy Editor Master Plan
-- Multi-translator support & caching for Quran/Hadith passages
-- ================================================================

-- ── 1. Add passage_key to scholarly_documents ─────────────────────────────────
ALTER TABLE public.scholarly_documents
  ADD COLUMN IF NOT EXISTS passage_key TEXT;

CREATE INDEX IF NOT EXISTS scholarly_documents_passage_key_idx
  ON public.scholarly_documents (passage_key);

-- Backfill passage_key for existing Quran rows
UPDATE public.scholarly_documents
SET passage_key = 'quran:' || (citation_ref->>'surah_number') || ':' || (citation_ref->>'verse')
WHERE passage_key IS NULL
  AND (citation_ref->>'surah_number') IS NOT NULL
  AND (citation_ref->>'verse') IS NOT NULL;

-- Backfill passage_key for existing Hadith rows
UPDATE public.scholarly_documents
SET passage_key = 'hadith:' || LOWER(COALESCE(citation_ref->>'collection', citation_ref->>'book', 'hadith')) || ':' || (citation_ref->>'hadith_number')
WHERE passage_key IS NULL
  AND (citation_ref->>'hadith_number') IS NOT NULL;

-- ── 2. Translators Registry ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.translators (
  slug                 TEXT PRIMARY KEY,
  full_name            TEXT NOT NULL,
  language             TEXT NOT NULL, -- 'ur' | 'en' | 'fa' | 'ar'
  corpus_type          TEXT NOT NULL DEFAULT 'quran', -- 'quran' | 'hadith' | 'general'
  maslak               TEXT,
  authority_note       TEXT,
  source               TEXT NOT NULL, -- 'quran.com' | 'alquran.cloud' | 'hadithapi' | 'manual'
  external_edition_id  TEXT,
  is_enabled           BOOLEAN NOT NULL DEFAULT true,
  sort_order           INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.translators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "translators_select_authenticated"
  ON public.translators FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "translators_service_role_all"
  ON public.translators FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Seed initial core translators
INSERT INTO public.translators (slug, full_name, language, corpus_type, maslak, source, external_edition_id, is_enabled, sort_order)
VALUES
  ('ur.jalandhari', 'مولانا فتح محمد جالندھری', 'ur', 'quran', 'سلیس و عام فہم', 'alquran.cloud', 'ur.jalandhari', true, 1),
  ('ur.jawaadi', 'علامہ ذیشان حیدر جوادی', 'ur', 'quran', 'شیعہ مکتبِ فکر', 'alquran.cloud', 'ur.jawaadi', true, 2),
  ('ur.kanzuliman', 'امام احمد رضا خان (کنز الایمان)', 'ur', 'quran', 'برلوی / باادب اسلوب', 'quran.com', 'ur-kanzuliman', true, 3),
  ('ur.maududi', 'مولانا ابوالاعلیٰ مودودی (تفہیم القرآن)', 'ur', 'quran', 'فکری و ادبی اسلوب', 'quran.com', 'ur-maududi', true, 4),
  ('ur.taqiusmani', 'مفتی محمد تقی عثمانی (آسان ترجمہ قرآن)', 'ur', 'quran', 'دیوبندی / با محاورہ اسلوب', 'quran.com', 'ur-taqiusmani', true, 5),
  ('ur.junagarhi', 'مولانا محمد جوناگڑھی', 'ur', 'quran', 'اہلِ حدیث / سلیس اسلوب', 'quran.com', 'ur-junagarhi', true, 6),
  ('en.saheeh', 'Saheeh International', 'en', 'quran', 'General / Modern English', 'quran.com', 'en-saheeh-international', true, 10),
  ('en.yusufali', 'Abdullah Yusuf Ali', 'en', 'quran', 'Classic English', 'quran.com', 'en-yusuf-ali', true, 11),
  ('en.khattab', 'The Clear Quran (Dr. Mustafa Khattab)', 'en', 'quran', 'Contemporary English', 'quran.com', 'en-clear-quran', true, 12)
ON CONFLICT (slug) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  language = EXCLUDED.language,
  source = EXCLUDED.source,
  external_edition_id = EXCLUDED.external_edition_id;

-- ── 3. Passage Translations Cache Table ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.passage_translations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passage_key     TEXT NOT NULL,
  translator_slug TEXT NOT NULL REFERENCES public.translators(slug) ON DELETE CASCADE,
  language        TEXT NOT NULL,
  text            TEXT NOT NULL,
  source_url      TEXT,
  is_verified     BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT passage_translations_unique_key_translator UNIQUE (passage_key, translator_slug)
);

CREATE INDEX IF NOT EXISTS passage_translations_passage_key_idx
  ON public.passage_translations (passage_key);

CREATE INDEX IF NOT EXISTS passage_translations_translator_slug_idx
  ON public.passage_translations (translator_slug);

ALTER TABLE public.passage_translations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "passage_translations_select_authenticated"
  ON public.passage_translations FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "passage_translations_service_role_all"
  ON public.passage_translations FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 4. RPC get_passage_translations ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_passage_translations(
  p_passage_key TEXT,
  p_slugs TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  passage_key TEXT,
  translator_slug TEXT,
  full_name TEXT,
  language TEXT,
  maslak TEXT,
  text TEXT,
  source_url TEXT,
  is_verified BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    pt.passage_key,
    pt.translator_slug,
    t.full_name,
    pt.language,
    t.maslak,
    pt.text,
    pt.source_url,
    pt.is_verified
  FROM public.passage_translations pt
  JOIN public.translators t ON t.slug = pt.translator_slug
  WHERE pt.passage_key = p_passage_key
    AND (p_slugs IS NULL OR pt.translator_slug = ANY(p_slugs))
  ORDER BY t.sort_order ASC, t.slug ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_passage_translations(TEXT, TEXT[]) TO authenticated;
