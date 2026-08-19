-- ================================================================
-- Retune ivfflat.probes for the enlarged corpus.
--
-- WHY: scholarly_documents_embedding_ivf_idx was built with lists = 100 back
-- when the corpus was small. It is now 412,028 embedded rows, so each list
-- holds ~4,120 vectors and probes = 10 makes every vector query scan ~41,200
-- of them -- about 10% of the corpus. Recall is fine; latency is the problem.
--
-- The fix is a finer index (lists = 640 ~= sqrt(412028)) plus proportionally
-- more probes. probes = 25 over 640 lists scans ~16,000 vectors (~4%), roughly
-- 2.5x less work than today, at a small recall cost.
--
-- ORDERING -- THIS MATTERS:
--   This migration is only correct AFTER the index has been rebuilt with
--   lists = 640. Applied while the index is still lists = 100, probes = 25
--   scans 25% of the corpus -- WORSE than the 10% it replaces.
--
--   Rebuild first, each statement on its own (CREATE/DROP INDEX CONCURRENTLY
--   cannot run inside a transaction block):
--
--     SET maintenance_work_mem = '512MB';
--     CREATE INDEX CONCURRENTLY scholarly_documents_embedding_ivf_v2
--       ON public.scholarly_documents
--       USING ivfflat (embedding vector_cosine_ops) WITH (lists = 640);
--     DROP INDEX CONCURRENTLY scholarly_documents_embedding_ivf_idx;
--     ALTER INDEX scholarly_documents_embedding_ivf_v2
--       RENAME TO scholarly_documents_embedding_ivf_idx;
--
-- Verify the index actually in place before/after with:
--   SELECT indexname, indexdef FROM pg_indexes
--   WHERE tablename = 'scholarly_documents'
--     AND (indexdef ILIKE '%ivfflat%' OR indexdef ILIKE '%hnsw%');
--
-- ivfflat recall degrades as rows are added, since centroids are fixed at build
-- time. lists = 640 has headroom for the growth already queued (~39k remaining
-- IUB hadith rows, ~10k rijal): at 470k rows that is still ~734 per list.
-- Revisit the lists value if the corpus passes roughly 800k rows.
--
-- Only the probes value changes below; the body is otherwise identical to
-- 20260730124957_84e91fd7-bb7c-4714-a12c-32c06da4b8b9.sql. CREATE OR REPLACE
-- keeps the existing grants, but they are restated at the end for clarity.
-- ================================================================

CREATE OR REPLACE FUNCTION public.match_scholarly_documents(
  query_embedding vector,
  match_threshold double precision,
  match_count integer,
  filter_domains text[] DEFAULT NULL,
  filter_language text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  domain text,
  source_type text,
  title text,
  content text,
  citation_ref jsonb,
  language text,
  source_url text,
  similarity double precision
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  PERFORM set_config('statement_timeout', '8000', true);
  -- was '10' against lists = 100; see the ORDERING note in the header.
  PERFORM set_config('ivfflat.probes', '25', true);

  RETURN QUERY
  SELECT c.id, c.domain, c.source_type, c.title, c.content, c.citation_ref,
         c.language, c.source_url, c.similarity
  FROM (
    SELECT sd.id, sd.domain, sd.source_type, sd.title, sd.content, sd.citation_ref,
           sd.language, sd.source_url,
           1 - (sd.embedding <=> query_embedding) AS similarity
    FROM public.scholarly_documents sd
    WHERE sd.embedding IS NOT NULL
      AND (filter_domains IS NULL OR sd.domain = ANY(filter_domains))
      AND (filter_language IS NULL OR sd.language = filter_language)
    ORDER BY sd.embedding <=> query_embedding
    LIMIT GREATEST(match_count, 1) * 4
  ) c
  WHERE c.similarity > match_threshold
  ORDER BY c.similarity DESC
  LIMIT match_count;
END;
$$;

COMMENT ON FUNCTION public.match_scholarly_documents(vector, double precision, integer, text[], text) IS
  'pgvector cosine search over scholarly_documents. ivfflat.probes = 25, paired with a lists = 640 index (~4% scan at 412k rows). Retune both together -- probes alone is meaningless.';

GRANT EXECUTE ON FUNCTION public.match_scholarly_documents(vector, double precision, integer, text[], text)
  TO authenticated, anon, service_role;
