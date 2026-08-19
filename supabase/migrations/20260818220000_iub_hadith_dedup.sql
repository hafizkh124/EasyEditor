-- ================================================================
-- Migration: Dedup index for IslamicUrduBooks hadith collection
-- Mirrors 20260724220100_urdu_hadith_dedup.sql for domain='islamicurdubooks-hadith'
-- ================================================================

CREATE UNIQUE INDEX IF NOT EXISTS scholarly_documents_iub_hadith_uidx
  ON public.scholarly_documents (
    (citation_ref->>'collection'),
    (citation_ref->>'hadith_number')
  )
  WHERE domain = 'islamicurdubooks-hadith';
