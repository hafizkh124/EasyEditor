
-- Speed up search_documents_smart via pg_trgm indexes on normalized text.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS scholarly_documents_content_ar_norm_trgm_idx
  ON public.scholarly_documents
  USING gin (public.normalize_arabic_text(content_ar) gin_trgm_ops)
  WHERE content_ar IS NOT NULL;

CREATE INDEX IF NOT EXISTS scholarly_documents_content_lower_trgm_idx
  ON public.scholarly_documents
  USING gin (lower(content) gin_trgm_ops)
  WHERE content IS NOT NULL;

-- Rewrite the RPC: cap query timeout to keep the request responsive, filter
-- first via any-term match (index-accelerated), then compute match_score.
CREATE OR REPLACE FUNCTION public.search_documents_smart(
  p_terms         text[],
  p_source_types  text[] DEFAULT NULL,
  p_match_limit   integer DEFAULT 30
)
RETURNS TABLE(
  id uuid, domain text, source_type text, content text, content_ar text,
  citation_ref jsonb, language text, source_url text, match_score integer
)
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $function$
DECLARE
  v_term       text;
  v_norm_terms text[] := ARRAY[]::text[];
BEGIN
  -- Prevent runaway scans; the caller falls back to other tiers on timeout.
  PERFORM set_config('statement_timeout', '8000', true);

  FOREACH v_term IN ARRAY p_terms LOOP
    IF v_term IS NOT NULL AND length(btrim(v_term)) >= 2 THEN
      v_norm_terms := array_append(v_norm_terms, public.normalize_arabic_text(v_term));
    END IF;
  END LOOP;

  IF array_length(v_norm_terms, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT sd.id, sd.domain, sd.source_type, sd.content, sd.content_ar,
           sd.citation_ref, sd.language, sd.source_url
    FROM scholarly_documents sd
    WHERE (p_source_types IS NULL OR sd.source_type = ANY (p_source_types))
      AND EXISTS (
        SELECT 1
        FROM unnest(v_norm_terms) AS t(term)
        WHERE public.normalize_arabic_text(sd.content_ar) ILIKE '%' || t.term || '%'
           OR lower(sd.content) ILIKE '%' || lower(t.term) || '%'
      )
    LIMIT p_match_limit * 4
  )
  SELECT c.id, c.domain, c.source_type, c.content, c.content_ar,
         c.citation_ref, c.language, c.source_url,
         (
           SELECT count(*)::int
           FROM unnest(v_norm_terms) AS t(term)
           WHERE public.normalize_arabic_text(c.content_ar) ILIKE '%' || t.term || '%'
              OR lower(c.content) ILIKE '%' || lower(t.term) || '%'
         ) AS match_score
  FROM candidates c
  ORDER BY match_score DESC, c.id
  LIMIT p_match_limit;
END;
$function$;
