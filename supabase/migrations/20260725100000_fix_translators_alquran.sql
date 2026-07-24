-- ================================================================
-- Migration: correct the translators registry to VERIFIED
-- alquran.cloud edition identifiers.
--
-- Why: the initial seed (20260725000000) mixed quran.com-style ids
-- (numeric translation resources) with alquran.cloud-style ids and
-- used slugs that do not match any real edition (e.g. ur.jalandhari,
-- en.saheeh). The extract-translations edge function fetches per-ayah
-- text from alquran.cloud using the edition identifier, so slug ==
-- alquran.cloud edition id keeps the mapping exact and prevents any
-- request that silently resolves to nothing.
--
-- Every identifier below was confirmed present in
--   GET https://api.alquran.cloud/v1/edition?type=translation
-- Translators NOT available on alquran.cloud (Taqi Usmani's Aasaan
-- Tarjuma, Khattab's Clear Quran) are intentionally omitted rather
-- than seeded with a dead id — they can be added later when a real
-- source is wired. Nothing here fabricates translation text.
-- ================================================================

-- The passage_translations cache references translator_slug ON DELETE
-- CASCADE. The cache is empty at this point, so replacing the seed is safe.
DELETE FROM public.translators;

INSERT INTO public.translators
  (slug, full_name, language, corpus_type, maslak, source, external_edition_id, is_enabled, sort_order)
VALUES
  -- ── Urdu ──────────────────────────────────────────────────────────
  ('ur.jalandhry',  'مولانا فتح محمد جالندھری',                'ur', 'quran', 'سلیس و عام فہم',            'alquran.cloud', 'ur.jalandhry',  true, 1),
  ('ur.junagarhi',  'مولانا محمد جوناگڑھی',                    'ur', 'quran', 'اہلِ حدیث / سلیس اسلوب',    'alquran.cloud', 'ur.junagarhi',  true, 2),
  ('ur.kanzuliman', 'امام احمد رضا خان (کنز الایمان)',          'ur', 'quran', 'بریلوی / باادب اسلوب',      'alquran.cloud', 'ur.kanzuliman', true, 3),
  ('ur.maududi',    'مولانا ابوالاعلیٰ مودودی (تفہیم القرآن)', 'ur', 'quran', 'فکری و ادبی اسلوب',         'alquran.cloud', 'ur.maududi',    true, 4),
  ('ur.qadri',      'ڈاکٹر طاہر القادری (عرفان القرآن)',        'ur', 'quran', 'بریلوی / بامحاورہ اسلوب',   'alquran.cloud', 'ur.qadri',      true, 5),
  ('ur.jawadi',     'علامہ ذیشان حیدر جوادی',                  'ur', 'quran', 'اہلِ تشیع',                 'alquran.cloud', 'ur.jawadi',     true, 6),
  -- ── English ───────────────────────────────────────────────────────
  ('en.sahih',      'Saheeh International',                     'en', 'quran', 'General / Modern English',  'alquran.cloud', 'en.sahih',      true, 10),
  ('en.yusufali',   'Abdullah Yusuf Ali',                      'en', 'quran', 'Classic English',           'alquran.cloud', 'en.yusufali',   true, 11),
  ('en.pickthall',  'Marmaduke Pickthall',                     'en', 'quran', 'Classic English',           'alquran.cloud', 'en.pickthall',  true, 12),
  -- ── Farsi ─────────────────────────────────────────────────────────
  ('fa.makarem',    'ناصر مکارم شیرازی',                        'fa', 'quran', 'فارسی',                     'alquran.cloud', 'fa.makarem',    true, 20),
  ('fa.ansarian',   'حسین انصاریان',                            'fa', 'quran', 'فارسی',                     'alquran.cloud', 'fa.ansarian',   true, 21);
