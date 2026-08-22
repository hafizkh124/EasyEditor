CREATE INDEX IF NOT EXISTS scholarly_documents_tohed_hadith_idx
  ON public.scholarly_documents (
    (citation_ref->>'collection'),
    (citation_ref->>'hadith_number')
  )
  WHERE domain = 'tohed-hadith'
    AND citation_ref->>'collection' IS NOT NULL
    AND citation_ref->>'hadith_number' IS NOT NULL;

CREATE INDEX IF NOT EXISTS scholarly_documents_easyquran_hadith_idx
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
      AND sd2.domain = ANY (ARRAY['hadith-json', 'urdu-hadith', 'tohed-hadith', 'easyquran-hadith'])
    LIMIT 1
  ) sd ON true;
END;
$$;

COMMENT ON FUNCTION public.scholarly_documents_lookup_by_citation(jsonb) IS
  'Phase E alignment probe: exact (collection, hadith_number) -> (domain, ar_fingerprint) lookup, scoped per row. Domain-allowlisted (not excluded) so the partial hadith indexes can be used. ar_fingerprint computed inline. statement_timeout 20s. Re-applied 2026-08-22 after a schema-pull migration reverted the allowlist to an exclusion.';

REVOKE ALL ON FUNCTION public.scholarly_documents_lookup_by_citation(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scholarly_documents_lookup_by_citation(jsonb) TO service_role;