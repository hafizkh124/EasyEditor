-- Tier K phase 2.4b: the SECOND branch (lower(content), Urdu/English text) and the full function.
-- Run D, then E twice (second run = warm cache). Paste Execution Time + Buffers lines.
-- Why: blocks A-C (tierk-candidate-cap.sql) only measured the content_ar branch;
-- 4 terms cost 0.7s there, but the live function takes 4.8s for 9 terms, so a large
-- share of the time is somewhere A-C did not look.

-- D: content (not content_ar) branch, same 4 terms, cap 600
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*) FROM (
  (SELECT sd.id FROM public.scholarly_documents sd
   WHERE sd.content IS NOT NULL
     AND lower(sd.content) ILIKE '%' || lower(public.normalize_arabic_text('الوالدين')) || '%'
     AND sd.source_type = ANY(ARRAY['hadith','fatwa'])
   LIMIT 600)
  UNION ALL
  (SELECT sd.id FROM public.scholarly_documents sd
   WHERE sd.content IS NOT NULL
     AND lower(sd.content) ILIKE '%' || lower(public.normalize_arabic_text('احسان')) || '%'
     AND sd.source_type = ANY(ARRAY['hadith','fatwa'])
   LIMIT 600)
  UNION ALL
  (SELECT sd.id FROM public.scholarly_documents sd
   WHERE sd.content IS NOT NULL
     AND lower(sd.content) ILIKE '%' || lower(public.normalize_arabic_text('عقوق')) || '%'
     AND sd.source_type = ANY(ARRAY['hadith','fatwa'])
   LIMIT 600)
  UNION ALL
  (SELECT sd.id FROM public.scholarly_documents sd
   WHERE sd.content IS NOT NULL
     AND lower(sd.content) ILIKE '%' || lower(public.normalize_arabic_text('صلة الرحم')) || '%'
     AND sd.source_type = ANY(ARRAY['hadith','fatwa'])
   LIMIT 600)
) c;

-- E: the real function, 9 terms (as before: was 4.85s)
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM public.search_documents_smart(
  ARRAY['بر الوالدين','الوالدين','احسان','عقوق','صلة الرحم','والدين','بر','أم','أب'],
  ARRAY['hadith','fatwa'],
  30);
