-- ================================================================
-- Fix: scholarly_documents_lookup_by_citation is catastrophically slow
-- (measured live: 51-row batch took 27-40s, vs 1.61s for a 200-row batch
-- against a different collection). Root cause is TWO compounding problems:
--
-- 1. The RPC's WHERE clause excluded a domain ("domain <> 'islamicurdubooks-
--    hadith'") instead of including known ones. Postgres can only use a
--    PARTIAL index when it can prove the query's WHERE clause implies that
--    index's own WHERE condition -- "domain <> X" does not imply "domain =
--    hadith-json" (dozens of other domain values also satisfy "<> X"), so
--    the planner could not use scholarly_documents_hadith_uidx or
--    scholarly_documents_urdu_hadith_uidx AT ALL, for ANY of the 25 target
--    collections, regardless of which domain they actually live in.
--
-- 2. Even with that fixed, two of the four domains these 25 collections
--    actually live under (tohed-hadith, easyquran-hadith -- confirmed via
--    live citation_ref.domain reads this session) have NO partial index on
--    (collection, hadith_number) at all. Only hadith-json and urdu-hadith
--    got one, historically (20260518080658, 20260724210717). Lookups against
--    tohed-hadith/easyquran-hadith rows would still fall back to scanning
--    within scholarly_documents_domain_type_idx's (domain, source_type)
--    bucket -- much better than a full-table scan, but not a true seek.
--
-- Fix: (a) switch the RPC to an explicit domain ALLOWLIST -- the same four
-- real hadith-source domains already established this session for
-- PSEUDO_DOMAIN_EXPANSION / HADITH_DOMAINS in vector-search and
-- citationEngine -- which the planner CAN prove implies each partial index's
-- condition; (b) add the two missing partial indexes so all four domains get
-- a true index seek, not just two of them. This isn't a one-off probe fix --
-- Phase E's full-book indexing step runs up to ~169,000 of these lookups
-- across 25 books, many landing in tohed-hadith specifically.
-- ================================================================

CREATE UNIQUE INDEX IF NOT EXISTS scholarly_documents_tohed_hadith_uidx
  ON public.scholarly_documents (
    (citation_ref->>'collection'),
    (citation_ref->>'hadith_number')
  )
  WHERE domain = 'tohed-hadith'
    AND citation_ref->>'collection' IS NOT NULL
    AND citation_ref->>'hadith_number' IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS scholarly_documents_easyquran_hadith_uidx
  ON public.scholarly_documents (
    (citation_ref->>'collection'),
    (citation_ref->>'hadith_number')
  )
  WHERE domain = 'easyquran-hadith'
    AND citation_ref->>'collection' IS NOT NULL
    AND citation_ref->>'hadith_number' IS NOT NULL;

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
      -- Explicit allowlist, not "<> islamicurdubooks-hadith": an exclusion
      -- can never let the planner prove a partial index's own domain
      -- condition holds, so none of the four indexes below it it would ever
      -- get used. These are the confirmed real domains the 25 Part-E target
      -- collections live in (same set as HADITH_DOMAINS in citationEngine.ts
      -- and PSEUDO_DOMAIN_EXPANSION in vector-search/index.ts).
      AND sd2.domain = ANY (ARRAY['hadith-json', 'urdu-hadith', 'tohed-hadith', 'easyquran-hadith'])
    LIMIT 1
  ) sd ON true;
END;
$$;

COMMENT ON FUNCTION public.scholarly_documents_lookup_by_citation(jsonb) IS
  'Phase E alignment probe: exact (collection, hadith_number) -> (domain, ar_fingerprint) lookup, scoped per row -- NOT a global fingerprint search. Domain-allowlisted (not excluded) so scholarly_documents_hadith_uidx / urdu_hadith_uidx / tohed_hadith_uidx / easyquran_hadith_uidx can all be used -- an exclusion clause defeats every partial index in the schema. statement_timeout raised to 20s for this batch/background RPC. Companion to scholarly_documents_check_batch, which is deliberately unscoped for its own (different) purpose.';

GRANT EXECUTE ON FUNCTION public.scholarly_documents_lookup_by_citation(jsonb) TO service_role;
