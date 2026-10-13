-- Tier K phase 2.4: how much does the per-term candidate cap cost? (read-only)
-- Today search_documents_smart uses LIMIT (p_match_limit * 20) = 600 per term branch.
-- Run A, B, C in order, then A again (to tell cache warm-up from a real difference).
-- Paste the 'Execution Time' and the 'Buffers:' (hit/read) lines of each run.

-- A: 4 terms, per-term candidate cap = 600
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*) FROM (
  (SELECT sd.id FROM public.scholarly_documents sd
   WHERE sd.content_ar IS NOT NULL
     AND public.normalize_arabic_text(sd.content_ar) ILIKE '%' || public.normalize_arabic_text('الوالدين') || '%'
     AND sd.source_type = ANY(ARRAY['hadith','fatwa'])
   LIMIT 600)
  UNION ALL
  (SELECT sd.id FROM public.scholarly_documents sd
   WHERE sd.content_ar IS NOT NULL
     AND public.normalize_arabic_text(sd.content_ar) ILIKE '%' || public.normalize_arabic_text('احسان') || '%'
     AND sd.source_type = ANY(ARRAY['hadith','fatwa'])
   LIMIT 600)
  UNION ALL
  (SELECT sd.id FROM public.scholarly_documents sd
   WHERE sd.content_ar IS NOT NULL
     AND public.normalize_arabic_text(sd.content_ar) ILIKE '%' || public.normalize_arabic_text('عقوق') || '%'
     AND sd.source_type = ANY(ARRAY['hadith','fatwa'])
   LIMIT 600)
  UNION ALL
  (SELECT sd.id FROM public.scholarly_documents sd
   WHERE sd.content_ar IS NOT NULL
     AND public.normalize_arabic_text(sd.content_ar) ILIKE '%' || public.normalize_arabic_text('صلة الرحم') || '%'
     AND sd.source_type = ANY(ARRAY['hadith','fatwa'])
   LIMIT 600)
) c;

-- B: 4 terms, per-term candidate cap = 150
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*) FROM (
  (SELECT sd.id FROM public.scholarly_documents sd
   WHERE sd.content_ar IS NOT NULL
     AND public.normalize_arabic_text(sd.content_ar) ILIKE '%' || public.normalize_arabic_text('الوالدين') || '%'
     AND sd.source_type = ANY(ARRAY['hadith','fatwa'])
   LIMIT 150)
  UNION ALL
  (SELECT sd.id FROM public.scholarly_documents sd
   WHERE sd.content_ar IS NOT NULL
     AND public.normalize_arabic_text(sd.content_ar) ILIKE '%' || public.normalize_arabic_text('احسان') || '%'
     AND sd.source_type = ANY(ARRAY['hadith','fatwa'])
   LIMIT 150)
  UNION ALL
  (SELECT sd.id FROM public.scholarly_documents sd
   WHERE sd.content_ar IS NOT NULL
     AND public.normalize_arabic_text(sd.content_ar) ILIKE '%' || public.normalize_arabic_text('عقوق') || '%'
     AND sd.source_type = ANY(ARRAY['hadith','fatwa'])
   LIMIT 150)
  UNION ALL
  (SELECT sd.id FROM public.scholarly_documents sd
   WHERE sd.content_ar IS NOT NULL
     AND public.normalize_arabic_text(sd.content_ar) ILIKE '%' || public.normalize_arabic_text('صلة الرحم') || '%'
     AND sd.source_type = ANY(ARRAY['hadith','fatwa'])
   LIMIT 150)
) c;

-- C: 4 terms, per-term candidate cap = 60
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*) FROM (
  (SELECT sd.id FROM public.scholarly_documents sd
   WHERE sd.content_ar IS NOT NULL
     AND public.normalize_arabic_text(sd.content_ar) ILIKE '%' || public.normalize_arabic_text('الوالدين') || '%'
     AND sd.source_type = ANY(ARRAY['hadith','fatwa'])
   LIMIT 60)
  UNION ALL
  (SELECT sd.id FROM public.scholarly_documents sd
   WHERE sd.content_ar IS NOT NULL
     AND public.normalize_arabic_text(sd.content_ar) ILIKE '%' || public.normalize_arabic_text('احسان') || '%'
     AND sd.source_type = ANY(ARRAY['hadith','fatwa'])
   LIMIT 60)
  UNION ALL
  (SELECT sd.id FROM public.scholarly_documents sd
   WHERE sd.content_ar IS NOT NULL
     AND public.normalize_arabic_text(sd.content_ar) ILIKE '%' || public.normalize_arabic_text('عقوق') || '%'
     AND sd.source_type = ANY(ARRAY['hadith','fatwa'])
   LIMIT 60)
  UNION ALL
  (SELECT sd.id FROM public.scholarly_documents sd
   WHERE sd.content_ar IS NOT NULL
     AND public.normalize_arabic_text(sd.content_ar) ILIKE '%' || public.normalize_arabic_text('صلة الرحم') || '%'
     AND sd.source_type = ANY(ARRAY['hadith','fatwa'])
   LIMIT 60)
) c;
