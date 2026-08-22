-- ================================================================
-- Re-fix: scholarly_documents_lookup_by_citation regressed back to
-- catastrophically slow (confirmed live 2026-08-22: 200-row batch took
-- 21-60s, vs 1.61s when this was last fixed on 2026-08-20).
--
-- Root cause: a later same-day migration sequence (20260820162611 ->
-- 20260820170908 -> 20260820171004, apparently a dashboard schema pull/
-- regeneration) did CREATE OR REPLACE FUNCTION from an OLDER template and
-- silently reverted the domain filter from the explicit allowlist fixed in
-- 20260820020000_lookup_by_citation_index_fix.sql back to
-- "domain <> 'islamicurdubooks-hadith'". That sequence did re-fix two other
-- things independently (ar_fingerprint computed inline again instead of
-- referencing a nonexistent column, and the 20s statement_timeout), which is
-- why this wasn't caught immediately -- the function looked fixed and ran
-- without erroring, just slowly.
--
-- Postgres can only use a PARTIAL index when it can prove the query's WHERE
-- clause implies that index's own WHERE condition. An exclusion
-- ("domain <> X") can never prove that for ANY of the four domain-specific
-- partial indexes (hadith-json, urdu-hadith, tohed-hadith, easyquran-hadith),
-- regardless of which one a given collection actually lives in -- so every
-- lookup fell back to a much worse plan across the whole table.
--
-- This migration is identical to 20260820020000's function body (the
-- allowlist fix), applied on top of the current (2026-08-20171004) inline
-- ar_fingerprint computation so both fixes are live together. The two
-- partial indexes from 20260820020000 are recreated IF NOT EXISTS in case a
-- future schema pull ever drops them too -- cheap insurance, no-op if they
-- already exist.
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
    SELECT sd2.id, sd2.passage_key, sd2.domain,
           CASE
             WHEN sd2.content_ar IS NOT NULL AND sd2.content_ar <> ''
             THEN md5(public.normalize_arabic_text(COALESCE(sd2.content_ar, '')))
           END AS ar_fingerprint,
           sd2.content_ar, sd2.source_url, sd2.citation_ref
    FROM public.scholarly_documents sd2
    WHERE sd2.citation_ref->>'collection' = p.collection
      AND sd2.citation_ref->>'hadith_number' = p.hadith_number
      -- Explicit allowlist, not "<> islamicurdubooks-hadith": an exclusion
      -- can never let the planner prove a partial index's own domain
      -- condition holds, so none of the four indexes below it would ever
      -- get used. These are the confirmed real domains the 25 Part-E target
      -- collections live in (same set as HADITH_DOMAINS in citationEngine.ts
      -- and PSEUDO_DOMAIN_EXPANSION in vector-search/index.ts).
      AND sd2.domain = ANY (ARRAY['hadith-json', 'urdu-hadith', 'tohed-hadith', 'easyquran-hadith'])
    LIMIT 1
  ) sd ON true;
END;
$$;

COMMENT ON FUNCTION public.scholarly_documents_lookup_by_citation(jsonb) IS
  'Phase E alignment probe: exact (collection, hadith_number) -> (domain, ar_fingerprint) lookup, scoped per row -- NOT a global fingerprint search. Domain-allowlisted (not excluded) so scholarly_documents_hadith_uidx / urdu_hadith_uidx / tohed_hadith_uidx / easyquran_hadith_uidx can all be used -- an exclusion clause defeats every partial index in the schema. ar_fingerprint computed inline (not a stored column). statement_timeout raised to 20s for this batch/background RPC. Re-applied 2026-08-22 after a dashboard schema-pull migration sequence silently reverted the allowlist back to an exclusion on 2026-08-20.';

REVOKE ALL ON FUNCTION public.scholarly_documents_lookup_by_citation(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scholarly_documents_lookup_by_citation(jsonb) TO service_role;
