-- ================================================================
-- Fix: scholarly_documents_lookup_by_citation times out on full 500-row
-- batches ("canceling statement due to statement timeout" after ~9s,
-- confirmed live). 500 correlated LATERAL lookups against
-- citation_ref->>'collection' / citation_ref->>'hadith_number' run at
-- roughly 16ms each -- fine individually, but the cumulative cost exceeds
-- whatever the service_role connection's default statement_timeout is (the
-- function set none of its own).
--
-- This is a background/batch RPC (Phase E's alignment probe and book-index
-- builder), not an interactive search path -- the 8s caps used elsewhere in
-- this codebase (search_documents_scoped, match_scholarly_documents) exist
-- for user-facing latency, which doesn't apply here. Raise it explicitly
-- rather than just shrinking the caller's batch size, since a slow index (or
-- a domain lacking a partial index over collection+hadith_number) could
-- still exceed a smaller batch's proportionally smaller default timeout.
--
-- Requires converting LANGUAGE sql -> LANGUAGE plpgsql: PERFORM is
-- plpgsql-only syntax. Same pattern as search_documents_scoped's own
-- PERFORM set_config('statement_timeout', ...) call.
-- ================================================================

CREATE OR REPLACE FUNCTION public.scholarly_documents_lookup_by_citation(payload jsonb)
RETURNS TABLE (
  collection     text,
  hadith_number  text,
  id             uuid,
  passage_key    text,
  domain         text,
  ar_fingerprint text,
  content_ar     text,
  source_url     text,
  citation_ref   jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('statement_timeout', '20000', true);

  RETURN QUERY
  SELECT
    p.collection,
    p.hadith_number,
    sd.id,
    sd.passage_key,
    sd.domain,
    sd.ar_fingerprint,
    sd.content_ar,
    sd.source_url,
    sd.citation_ref
  FROM jsonb_to_recordset(payload) AS p(collection text, hadith_number text)
  LEFT JOIN LATERAL (
    SELECT sd2.id, sd2.passage_key, sd2.domain, sd2.ar_fingerprint,
           sd2.content_ar, sd2.source_url, sd2.citation_ref
    FROM public.scholarly_documents sd2
    WHERE sd2.citation_ref->>'collection' = p.collection
      AND sd2.citation_ref->>'hadith_number' = p.hadith_number
      AND sd2.domain <> 'islamicurdubooks-hadith'
    LIMIT 1
  ) sd ON true;
END;
$$;

COMMENT ON FUNCTION public.scholarly_documents_lookup_by_citation(jsonb) IS
  'Phase E alignment probe: exact (collection, hadith_number) -> (domain, ar_fingerprint) lookup, scoped per row -- NOT a global fingerprint search. statement_timeout raised to 20s for this batch/background RPC (500-row LATERAL batches measured ~9s against the platform default). Companion to scholarly_documents_check_batch, which is deliberately unscoped for its own (different) purpose.';

GRANT EXECUTE ON FUNCTION public.scholarly_documents_lookup_by_citation(jsonb) TO service_role;
