-- ================================================================
-- Add content_ar to match_scholarly_documents's output.
--
-- Corpus Atlas finding #7: "the corpus's own language field can't back an
-- 'Arabic only' toggle... any real Arabic/Urdu split has to check
-- content_ar IS NOT NULL per row instead." Building that toggle needs every
-- retrieval path to know, per row, whether it actually carries Arabic matn --
-- search_documents_scoped and search_documents_smart already return
-- content_ar, but this RPC (the semantic/pgvector channel, called by
-- vector-search/index.ts, citationEngine's semanticChannel, and
-- classicalSemanticChannel) never did. Without it, Tier B and the semantic
-- half of Tier D had no way to answer "does this row have real Arabic
-- wording", so an Arabic-only filter downstream of them would have had to
-- guess or silently drop every row they contributed.
--
-- Body is otherwise byte-identical to 20260819100000's version -- same
-- ivfflat.probes = 25 / lists = 640 pairing, same statement_timeout, same
-- oversampling (LIMIT match_count * 4 before the threshold filter). Do not
-- retune anything here; this migration's only job is the added column.
-- ================================================================

DROP FUNCTION IF EXISTS public.match_scholarly_documents(vector, double precision, integer, text[], text);

CREATE FUNCTION public.match_scholarly_documents(
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
  content_ar text,
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
  PERFORM set_config('ivfflat.probes', '25', true);

  RETURN QUERY
  SELECT c.id, c.domain, c.source_type, c.title, c.content, c.content_ar, c.citation_ref,
         c.language, c.source_url, c.similarity
  FROM (
    SELECT sd.id, sd.domain, sd.source_type, sd.title, sd.content, sd.content_ar, sd.citation_ref,
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
  'pgvector cosine search over scholarly_documents. ivfflat.probes = 25, paired with a lists = 640 index (~4% scan at 412k rows). Retune both together -- probes alone is meaningless. Returns content_ar (added 2026-08-24) so callers can tell whether a semantically-matched row actually carries Arabic matn, for the Arabic-only source filter.';

GRANT EXECUTE ON FUNCTION public.match_scholarly_documents(vector, double precision, integer, text[], text)
  TO authenticated, anon, service_role;
