-- ================================================================
-- Cross-domain duplicate detection for the Islamic corpus upload wave.
--
-- Problem: existing dedup indexes are all scoped BY DOMAIN
-- (scholarly_documents_hadith_uidx WHERE domain='hadith-json', the
-- content_hash index is (domain, source_type, md5(content))). New lanes use
-- new domain values (urdu-hadith, tanzil-urdu), so the same hadith arriving
-- from a different source is never detected -- and md5(content) is exact-byte,
-- so a tashkeel difference defeats it anyway even within one domain.
--
-- Fix: an Arabic-normalized fingerprint (stored, so it can be indexed) plus a
-- read-only RPC the loader's --check-only mode can call before writing
-- anything, that reports *why* a row already exists (content_hash /
-- citation_key / ar_fingerprint) without inserting.
-- ================================================================

-- ── Arabic fingerprint ──────────────────────────────────────────────────────
-- normalize_arabic_text() is IMMUTABLE PARALLEL SAFE (see
-- 20260517000000_smart_arabic_search.sql), so it can back a stored generated
-- column. Deliberately NOT unique: the same hadith arriving with an Urdu
-- translation attached is complementary content, not a duplicate to reject --
-- detection first, load-time policy second.
ALTER TABLE public.scholarly_documents
  ADD COLUMN IF NOT EXISTS ar_fingerprint text
  GENERATED ALWAYS AS (md5(public.normalize_arabic_text(coalesce(content_ar, '')))) STORED;

CREATE INDEX IF NOT EXISTS scholarly_documents_ar_fingerprint_idx
  ON public.scholarly_documents (ar_fingerprint)
  WHERE content_ar IS NOT NULL AND content_ar <> '';

-- ── scholarly_documents_check_batch ─────────────────────────────────────────
-- Given a JSONB array of candidate rows (same shape ingest-batch accepts:
-- domain, source_type, content, content_ar, citation_ref), returns one result
-- per input row: { exists, reason, match_domain }. reason is one of
-- 'content_hash' | 'citation_key' | 'ar_fingerprint' | null. Read-only —
-- never touches the table.
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

    -- 1. exact content repeat within the same lane (mirrors
    --    scholarly_documents_content_hash_uidx).
    v_exists := EXISTS (
      SELECT 1 FROM public.scholarly_documents sd
      WHERE sd.domain = v_domain AND sd.source_type = v_source_type
        AND md5(sd.content) = v_content_hash
    );
    IF v_exists THEN v_reason := 'content_hash'; END IF;

    -- 2. same hadith citation already present in this domain.
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

    -- 3. same verse citation already present in this domain.
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

    -- 4. same Arabic text already present under a DIFFERENT domain --
    --    informational (e.g. hadeed-urdu vs hadith-json), not necessarily a
    --    row to skip; the loader reports this separately from hard dupes.
    IF NOT v_exists AND coalesce(r->>'content_ar', '') <> '' THEN
      v_ar_fp := md5(public.normalize_arabic_text(r->>'content_ar'));
      SELECT sd.domain INTO v_match_domain
      FROM public.scholarly_documents sd
      WHERE sd.ar_fingerprint = v_ar_fp AND sd.domain <> v_domain
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

-- service_role only: called from the ingest-batch edge function (which is
-- already gated by INGEST_SHARED_SECRET), not exposed to authenticated/anon.
GRANT EXECUTE ON FUNCTION public.scholarly_documents_check_batch(jsonb) TO service_role;
