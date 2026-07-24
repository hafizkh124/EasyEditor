SET statement_timeout = '600s';

CREATE INDEX IF NOT EXISTS scholarly_documents_ar_fingerprint_idx
  ON public.scholarly_documents (md5(public.normalize_arabic_text(coalesce(content_ar, ''))))
  WHERE content_ar IS NOT NULL AND content_ar <> '';

CREATE OR REPLACE FUNCTION public.scholarly_documents_check_batch(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  results         jsonb := '[]'::jsonb;
  r               jsonb;
  v_domain        text;
  v_source_type   text;
  v_content_hash  text;
  v_collection    text;
  v_hadith_number text;
  v_surah         text;
  v_verse         text;
  v_ar_fp         text;
  v_exists        boolean;
  v_reason        text;
  v_match_domain  text;
BEGIN
  FOR r IN SELECT value FROM jsonb_array_elements(payload) AS t(value)
  LOOP
    v_domain       := r->>'domain';
    v_source_type  := r->>'source_type';
    v_content_hash := md5(coalesce(r->>'content', ''));
    v_reason       := NULL;
    v_match_domain := NULL;

    v_exists := EXISTS (
      SELECT 1 FROM public.scholarly_documents sd
      WHERE sd.domain = v_domain AND sd.source_type = v_source_type
        AND md5(sd.content) = v_content_hash
    );
    IF v_exists THEN v_reason := 'content_hash'; END IF;

    IF NOT v_exists THEN
      v_collection    := r->'citation_ref'->>'collection';
      v_hadith_number := r->'citation_ref'->>'hadith_number';
      IF v_collection IS NOT NULL AND v_hadith_number IS NOT NULL THEN
        v_exists := EXISTS (
          SELECT 1 FROM public.scholarly_documents sd
          WHERE sd.domain = v_domain
            AND sd.citation_ref->>'collection' = v_collection
            AND sd.citation_ref->>'hadith_number' = v_hadith_number
        );
        IF v_exists THEN v_reason := 'citation_key'; END IF;
      END IF;
    END IF;

    IF NOT v_exists THEN
      v_surah := r->'citation_ref'->>'surah_number';
      v_verse := r->'citation_ref'->>'verse';
      IF v_surah IS NOT NULL AND v_verse IS NOT NULL THEN
        v_exists := EXISTS (
          SELECT 1 FROM public.scholarly_documents sd
          WHERE sd.domain = v_domain
            AND sd.citation_ref->>'surah_number' = v_surah
            AND sd.citation_ref->>'verse' = v_verse
        );
        IF v_exists THEN v_reason := 'citation_key'; END IF;
      END IF;
    END IF;

    IF NOT v_exists AND coalesce(r->>'content_ar', '') <> '' THEN
      v_ar_fp := md5(public.normalize_arabic_text(r->>'content_ar'));
      SELECT sd.domain INTO v_match_domain
      FROM public.scholarly_documents sd
      WHERE sd.content_ar IS NOT NULL AND sd.content_ar <> ''
        AND md5(public.normalize_arabic_text(coalesce(sd.content_ar, ''))) = v_ar_fp
        AND sd.domain <> v_domain
      LIMIT 1;
      IF v_match_domain IS NOT NULL THEN
        v_exists := true;
        v_reason := 'ar_fingerprint';
      END IF;
    END IF;

    results := results || jsonb_build_object(
      'exists', v_exists,
      'reason', v_reason,
      'match_domain', v_match_domain
    );
  END LOOP;

  RETURN results;
END;
$$;

COMMENT ON FUNCTION public.scholarly_documents_check_batch(jsonb) IS
  'Read-only pre-flight for scripts/supabase_bulk_load.py --check-only. Given candidate rows in the ingest-batch payload shape, reports per-row whether the row already exists and why, without inserting anything.';

GRANT EXECUTE ON FUNCTION public.scholarly_documents_check_batch(jsonb) TO service_role;