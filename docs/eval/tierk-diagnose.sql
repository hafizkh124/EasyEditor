-- Tier K latency diagnosis (read-only). Run each numbered block SEPARATELY in the
-- Supabase SQL editor and paste the results back. Nothing here writes data.
-- Context: live measurements 2026-10-13 showed search_documents_smart / _scoped
-- taking 4.6-19.8s per query (docs/PHASE0-DIAGNOSIS-URDU.md, appendix).

-- 1) Are the two partial trigram indexes present and VALID?
SELECT i.indexrelid::regclass AS index_name,
       i.indisvalid, i.indisready,
       pg_size_pretty(pg_relation_size(i.indexrelid)) AS size,
       pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index i
WHERE i.indrelid = 'public.scholarly_documents'::regclass
ORDER BY 1;

-- 2) What does the LIVE function look like? (checks drift vs. the repo's migrations)
SELECT p.proname, pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('search_documents_smart', 'search_documents_scoped', 'normalize_arabic_text');

-- 3) Table size and whether statistics are fresh
SELECT relname, n_live_tup, n_dead_tup, last_analyze, last_autoanalyze, last_vacuum, last_autovacuum,
       pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_stat_user_tables
WHERE relname = 'scholarly_documents';

-- 4) One LONG term (>=3 chars): should use the trigram index (look for "Bitmap Index Scan").
EXPLAIN (ANALYZE, BUFFERS)
SELECT sd.id FROM public.scholarly_documents sd
WHERE sd.content_ar IS NOT NULL
  AND public.normalize_arabic_text(sd.content_ar) ILIKE '%' || public.normalize_arabic_text('الوالدين') || '%'
LIMIT 600;

-- 5) One SHORT term (2 chars): a trigram index cannot help with <3 characters, so
--    this is expected to be a sequential scan calling normalize_arabic_text per row.
--    Terms of length >= 2 are accepted by the function today.
EXPLAIN (ANALYZE, BUFFERS)
SELECT sd.id FROM public.scholarly_documents sd
WHERE sd.content_ar IS NOT NULL
  AND public.normalize_arabic_text(sd.content_ar) ILIKE '%' || public.normalize_arabic_text('بر') || '%'
LIMIT 600;

-- 6) The whole function, as the app calls it for sample question 6 (hadith + fatwa).
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM public.search_documents_smart(
  ARRAY['بر الوالدين','الوالدين','احسان','عقوق','صلة الرحم','والدين','بر','أم','أب'],
  ARRAY['hadith','fatwa'],
  30);
