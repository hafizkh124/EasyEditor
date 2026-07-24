
CREATE INDEX IF NOT EXISTS scholarly_documents_urdu_hadith_uidx
  ON public.scholarly_documents (
    (citation_ref->>'collection'),
    (citation_ref->>'hadith_number')
  )
  WHERE domain = 'urdu-hadith'
    AND citation_ref->>'collection' IS NOT NULL
    AND citation_ref->>'hadith_number' IS NOT NULL;

ALTER TABLE public.scholarly_documents
  ADD COLUMN IF NOT EXISTS passage_key TEXT;

CREATE INDEX IF NOT EXISTS scholarly_documents_passage_key_idx
  ON public.scholarly_documents (passage_key);

CREATE INDEX IF NOT EXISTS scholarly_documents_discipline_idx
  ON public.scholarly_documents ((citation_ref->>'discipline'));

CREATE TABLE IF NOT EXISTS public.translators (
  slug                 TEXT PRIMARY KEY,
  full_name            TEXT NOT NULL,
  language             TEXT NOT NULL,
  corpus_type          TEXT NOT NULL DEFAULT 'quran',
  maslak               TEXT,
  authority_note       TEXT,
  source               TEXT NOT NULL,
  external_edition_id  TEXT,
  is_enabled           BOOLEAN NOT NULL DEFAULT true,
  sort_order           INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.translators TO authenticated;
GRANT ALL ON public.translators TO service_role;

ALTER TABLE public.translators ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "translators_select_authenticated" ON public.translators;
CREATE POLICY "translators_select_authenticated"
  ON public.translators FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "translators_service_role_all" ON public.translators;
CREATE POLICY "translators_service_role_all"
  ON public.translators FOR ALL TO service_role USING (true) WITH CHECK (true);

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

GRANT SELECT ON public.passage_translations TO authenticated;
GRANT ALL ON public.passage_translations TO service_role;

ALTER TABLE public.passage_translations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "passage_translations_select_authenticated" ON public.passage_translations;
CREATE POLICY "passage_translations_select_authenticated"
  ON public.passage_translations FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "passage_translations_service_role_all" ON public.passage_translations;
CREATE POLICY "passage_translations_service_role_all"
  ON public.passage_translations FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.translators
  (slug, full_name, language, corpus_type, maslak, source, external_edition_id, is_enabled, sort_order)
VALUES
  ('ur.jalandhry',  'مولانا فتح محمد جالندھری',                'ur', 'quran', 'سلیس و عام فہم',            'alquran.cloud', 'ur.jalandhry',  true, 1),
  ('ur.junagarhi',  'مولانا محمد جوناگڑھی',                    'ur', 'quran', 'اہلِ حدیث / سلیس اسلوب',    'alquran.cloud', 'ur.junagarhi',  true, 2),
  ('ur.kanzuliman', 'امام احمد رضا خان (کنز الایمان)',          'ur', 'quran', 'بریلوی / باادب اسلوب',      'alquran.cloud', 'ur.kanzuliman', true, 3),
  ('ur.maududi',    'مولانا ابوالاعلیٰ مودودی (تفہیم القرآن)', 'ur', 'quran', 'فکری و ادبی اسلوب',         'alquran.cloud', 'ur.maududi',    true, 4),
  ('ur.qadri',      'ڈاکٹر طاہر القادری (عرفان القرآن)',        'ur', 'quran', 'بریلوی / بامحاورہ اسلوب',   'alquran.cloud', 'ur.qadri',      true, 5),
  ('ur.jawadi',     'علامہ ذیشان حیدر جوادی',                  'ur', 'quran', 'اہلِ تشیع',                 'alquran.cloud', 'ur.jawadi',     true, 6),
  ('en.sahih',      'Saheeh International',                     'en', 'quran', 'General / Modern English',  'alquran.cloud', 'en.sahih',      true, 10),
  ('en.yusufali',   'Abdullah Yusuf Ali',                       'en', 'quran', 'Classic English',           'alquran.cloud', 'en.yusufali',   true, 11),
  ('en.pickthall',  'Marmaduke Pickthall',                      'en', 'quran', 'Classic English',           'alquran.cloud', 'en.pickthall',  true, 12),
  ('fa.makarem',    'ناصر مکارم شیرازی',                        'fa', 'quran', 'فارسی',                     'alquran.cloud', 'fa.makarem',    true, 20),
  ('fa.ansarian',   'حسین انصاریان',                            'fa', 'quran', 'فارسی',                     'alquran.cloud', 'fa.ansarian',   true, 21),
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
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
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

CREATE OR REPLACE FUNCTION public.search_classical_scoped(
  p_patterns    text[],
  p_disciplines text[]  DEFAULT NULL,
  p_limit       int     DEFAULT 30
)
RETURNS TABLE (
  id uuid, domain text, source_type text, content text, content_ar text,
  citation_ref jsonb, language text, source_url text, passage_key text,
  match_score integer
)
LANGUAGE plpgsql STABLE PARALLEL SAFE SET search_path = public AS $$
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
      SELECT count(*)::int FROM unnest(v_norm_patterns) AS t(term)
      WHERE public.normalize_arabic_text(sd.content_ar) ILIKE '%' || t.term || '%'
    ) AS match_score
  FROM public.scholarly_documents sd
  WHERE sd.content_ar IS NOT NULL
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
