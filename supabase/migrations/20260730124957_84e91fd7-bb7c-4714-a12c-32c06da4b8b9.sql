DROP FUNCTION IF EXISTS public.match_scholarly_documents(vector, double precision, integer, text[], text);

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
  PERFORM set_config('ivfflat.probes', '10', true);

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

GRANT EXECUTE ON FUNCTION public.match_scholarly_documents(vector, double precision, integer, text[], text)
  TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.search_documents_scoped(
  p_patterns     text[],
  p_source_types text[]  DEFAULT NULL,
  p_collections  text[]  DEFAULT NULL,
  p_surah        int     DEFAULT NULL,
  p_limit        int     DEFAULT 30
)
RETURNS TABLE (
  id           uuid,
  domain       text,
  source_type  text,
  content      text,
  content_ar   text,
  citation_ref jsonb,
  language     text,
  source_url   text,
  match_score  integer
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_pattern       text;
  v_norm_patterns text[] := ARRAY[]::text[];
  v_candidates    uuid[] := ARRAY[]::uuid[];
  v_ids           uuid[];
  v_per_pattern   int;
BEGIN
  PERFORM set_config('statement_timeout', '8000', true);

  FOREACH v_pattern IN ARRAY p_patterns LOOP
    IF v_pattern IS NOT NULL AND length(btrim(v_pattern)) >= 2 THEN
      v_norm_patterns := array_append(v_norm_patterns, public.normalize_arabic_text(v_pattern));
    END IF;
  END LOOP;

  IF array_length(v_norm_patterns, 1) IS NULL THEN
    RETURN;
  END IF;

  v_per_pattern := GREATEST(p_limit, 30) * 10;

  FOREACH v_pattern IN ARRAY v_norm_patterns LOOP
    SELECT array_agg(sub.id) INTO v_ids
    FROM (
      SELECT sd2.id
      FROM public.scholarly_documents sd2
      WHERE sd2.content_ar IS NOT NULL
        AND public.normalize_arabic_text(sd2.content_ar) ILIKE '%' || v_pattern || '%'
        AND (p_source_types IS NULL OR sd2.source_type = ANY(p_source_types))
        AND (p_collections  IS NULL OR (sd2.citation_ref->>'collection') = ANY(p_collections))
        AND (p_surah        IS NULL OR (sd2.citation_ref->>'surah_number')::int = p_surah)
      LIMIT v_per_pattern
    ) sub;

    IF v_ids IS NOT NULL THEN
      v_candidates := v_candidates || v_ids;
    END IF;
  END LOOP;

  IF array_length(v_candidates, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    sd.id, sd.domain, sd.source_type, sd.content, sd.content_ar, sd.citation_ref,
    sd.language, sd.source_url,
    (
      SELECT count(*)::int
      FROM unnest(v_norm_patterns) AS t(term)
      WHERE public.normalize_arabic_text(sd.content_ar) ILIKE '%' || t.term || '%'
    ) AS match_score
  FROM public.scholarly_documents sd
  WHERE sd.id = ANY(v_candidates)
  ORDER BY match_score DESC, sd.id
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_documents_scoped(text[], text[], text[], int, int)
  TO authenticated, anon, service_role;