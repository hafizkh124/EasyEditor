-- Phase E (Part 1) infrastructure: verified citation remapping for the
-- 25 pre-existing hadith collections against IslamicUrduBooks.
--
-- NOTE: ar_fingerprint is NOT a stored column on scholarly_documents -- it
-- exists only as the functional expression behind
-- scholarly_documents_ar_fingerprint_idx:
--   md5(normalize_arabic_text(COALESCE(content_ar, '')))
--     WHERE content_ar IS NOT NULL AND content_ar <> ''
-- so it is computed inline here, using the exact same expression so the
-- index is usable and the value matches scripts/iub/ar_normalize.py's
-- Python port character-for-character.

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
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
      AND sd2.domain <> 'islamicurdubooks-hadith'
    LIMIT 1
  ) sd ON true;
$$;

COMMENT ON FUNCTION public.scholarly_documents_lookup_by_citation(jsonb) IS
  'Phase E alignment probe: exact (collection, hadith_number) -> (domain, ar_fingerprint) lookup, scoped per row -- NOT a global fingerprint search. ar_fingerprint is computed inline as md5(normalize_arabic_text(content_ar)); it is not a stored column.';

GRANT EXECUTE ON FUNCTION public.scholarly_documents_lookup_by_citation(jsonb) TO service_role;


CREATE OR REPLACE FUNCTION public.scholarly_documents_update_citation(payload jsonb)
RETURNS TABLE (
  passage_key text,
  updated     boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r              jsonb;
  v_passage_key  text;
  v_source_url   text;
  v_patch        jsonb;
  v_rows         int;
BEGIN
  FOR r IN SELECT value FROM jsonb_array_elements(payload) AS t(value)
  LOOP
    v_passage_key := r->>'passage_key';
    v_source_url  := r->>'source_url';
    v_patch       := r->'citation_ref_patch';

    IF v_passage_key IS NULL OR v_source_url IS NULL OR v_patch IS NULL THEN
      passage_key := v_passage_key;
      updated := false;
      RETURN NEXT;
      CONTINUE;
    END IF;

    UPDATE public.scholarly_documents sd
    SET
      -- Archive the CURRENT source_url only if not already archived, so a
      -- second run never overwrites true provenance with a previously
      -- written IUB url.
      citation_ref = (sd.citation_ref || v_patch) || jsonb_build_object(
        'original_source_url',
        COALESCE(sd.citation_ref->>'original_source_url', sd.source_url)
      ),
      source_url = v_source_url
    WHERE sd.passage_key = v_passage_key;

    GET DIAGNOSTICS v_rows = ROW_COUNT;

    passage_key := v_passage_key;
    updated := v_rows > 0;
    RETURN NEXT;

    IF v_rows > 1 THEN
      RAISE WARNING 'scholarly_documents_update_citation: passage_key % matched % rows, expected at most 1', v_passage_key, v_rows;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.scholarly_documents_update_citation(jsonb) IS
  'Phase E apply step: patches citation_ref with IUB deep-link fields and sets source_url to the new IUB url, archiving the prior source_url into citation_ref.original_source_url exactly once. Called from ingest-batch mode=update-citation.';

GRANT EXECUTE ON FUNCTION public.scholarly_documents_update_citation(jsonb) TO service_role;