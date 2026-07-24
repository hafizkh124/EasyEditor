-- ================================================================
-- Migration: hadith translator registry rows for /extract.
--
-- Quran passages have many named tarajim (alquran.cloud editions). A hadith,
-- by contrast, comes from HadithAPI.com as one record carrying the Arabic text
-- plus (where available) an Urdu and an English rendering — not a set of named
-- competing translators. So we register three generic per-language entries and
-- cache each into passage_translations just like a Quran edition:
--   hadith.ar → the Arabic matn (surfaced as the passage's `arabic`)
--   hadith.ur → Urdu translation
--   hadith.en → English translation
--
-- external_edition_id holds the HadithAPI response FIELD name the edge function
-- reads for that language. Nothing here fabricates text; the edge function only
-- caches what HadithAPI actually returns.
-- ================================================================

INSERT INTO public.translators
  (slug, full_name, language, corpus_type, maslak, source, external_edition_id, is_enabled, sort_order)
VALUES
  ('hadith.ar', 'عربی متن (HadithAPI)',   'ar', 'hadith', NULL, 'hadithapi', 'hadithArabic',  true, 28),
  ('hadith.ur', 'اردو ترجمہ (HadithAPI)', 'ur', 'hadith', NULL, 'hadithapi', 'hadithUrdu',    true, 29),
  ('hadith.en', 'English (HadithAPI)',     'en', 'hadith', NULL, 'hadithapi', 'hadithEnglish', true, 30)
ON CONFLICT (slug) DO UPDATE SET
  full_name           = EXCLUDED.full_name,
  language            = EXCLUDED.language,
  corpus_type         = EXCLUDED.corpus_type,
  source              = EXCLUDED.source,
  external_edition_id = EXCLUDED.external_edition_id,
  is_enabled          = EXCLUDED.is_enabled,
  sort_order          = EXCLUDED.sort_order;
