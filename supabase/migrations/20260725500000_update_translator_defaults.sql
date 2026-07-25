-- ================================================================
-- Migration: Update translator defaults
--
-- Disables the Shia translation (Jawadi) by default and puts the commonly
-- expected Urdu translators first. Enabling Jawadi stays available to the
-- user — this only changes what is pre-selected.
--
-- NOTE ON SLUGS: the registry seeds slug == the alquran.cloud edition id
-- (see 20260725100000). The correct id is `ur.jawadi` (one "a"). An earlier
-- draft of this file used `ur.jawaadi`, which matches no row, so the intended
-- disable silently did nothing.
--
-- `ur.taqiusmani` is intentionally absent: Mufti Taqi Usmani's Aasaan Tarjuma
-- is not published as an alquran.cloud edition, so no row exists to order. It
-- is left out rather than seeded with a dead id (which would fetch nothing and
-- appear as a broken translator in /extract). Re-add it here once a real
-- source is wired.
-- ================================================================

UPDATE public.translators
SET is_enabled = false, sort_order = 99
WHERE slug = 'ur.jawadi';

UPDATE public.translators
SET sort_order = 1, is_enabled = true
WHERE slug = 'ur.jalandhry';

UPDATE public.translators
SET sort_order = 2, is_enabled = true
WHERE slug = 'ur.junagarhi';

UPDATE public.translators
SET sort_order = 3
WHERE slug = 'ur.kanzuliman';

UPDATE public.translators
SET sort_order = 4
WHERE slug = 'ur.maududi';

UPDATE public.translators
SET sort_order = 5
WHERE slug = 'ur.qadri';
