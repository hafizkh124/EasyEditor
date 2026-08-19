-- ================================================================
-- Rebuild the pgvector index at lists = 640 AND move probes to 25.
--
-- These two MUST land together. Either alone makes things worse:
--   lists = 100 + probes = 25  -> scans 25% of the corpus (worse than today)
--   lists = 640 + probes = 10  -> scans ~1.6%, recall falls off
-- Keeping them in one transactional migration makes a half-applied state
-- impossible; that is why the executable half of
-- 20260819000000_ivfflat_probes_retune.sql was moved down here.
--
-- WHY: scholarly_documents_embedding_ivf_idx was built WITH (lists = 100)
-- when the corpus was small. At 412,028 embedded rows each list holds ~4,120
-- vectors, so probes = 10 scans ~41,200 of them -- about 10% of the corpus,
-- measured at ~4.1s per query. lists = 640 (~sqrt(412028)) with probes = 25
-- scans ~16,000 (~4%).
--
-- LOCK ORDER -- deliberate:
--   Build the new index FIRST under a temporary name. CREATE INDEX takes a
--   SHARE lock: reads (i.e. all search traffic) keep working, writes block.
--   Only then drop the old index and rename, which needs ACCESS EXCLUSIVE and
--   blocks reads too -- so it is kept to the last moments of the transaction.
--   Dropping first, as is tempting, would hold ACCESS EXCLUSIVE for the entire
--   build and take searches down with it.
--
-- OPERATIONS:
--   * Pause ingestion before running. Writes to scholarly_documents are blocked
--     for the whole build.
--   * Apply with `npx supabase db push`, NOT an HTTP SQL runner. A previous
--     attempt through the HTTP gateway returned 524; the backend finished the
--     build, then found the client gone and rolled the whole thing back. db push
--     connects straight over TCP as the table owner, so neither the gateway
--     timeout nor the DDL permission problem applies.
--   * statement_timeout is lifted for this transaction only.
--
-- Re-runnable: the temp index is dropped if a previous attempt left one behind,
-- and CREATE OR REPLACE FUNCTION is idempotent.
--
-- ivfflat centroids are fixed at build time, so recall drifts as rows are added.
-- lists = 640 has headroom for the growth already queued (~39k remaining IUB
-- hadith rows, ~10k rijal): at 470k rows that is still ~734 per list. Revisit
-- once the corpus passes roughly 800k rows.
-- ================================================================

SET LOCAL statement_timeout = 0;
SET LOCAL lock_timeout = '5min';
SET LOCAL maintenance_work_mem = '512MB';

-- Clear any leftover from a rolled-back attempt.
DROP INDEX IF EXISTS public.scholarly_documents_embedding_ivf_v2;

-- Long phase, SHARE lock: search traffic continues, writes wait.
CREATE INDEX scholarly_documents_embedding_ivf_v2
  ON public.scholarly_documents
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 640);

-- Short phase, ACCESS EXCLUSIVE: swap old for new.
DROP INDEX IF EXISTS public.scholarly_documents_embedding_ivf_idx;
ALTER INDEX public.scholarly_documents_embedding_ivf_v2
  RENAME TO scholarly_documents_embedding_ivf_idx;

-- ── probes 10 -> 25, paired with the lists = 640 index above ────────────────
-- Body is otherwise identical to
-- 20260730124957_84e91fd7-bb7c-4714-a12c-32c06da4b8b9.sql.

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
  -- was '10' against lists = 100; retuned with the rebuild in this migration.
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
