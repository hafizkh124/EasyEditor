-- ================================================================
-- Phase E (Part 1) infrastructure: verified citation remapping for the
-- 25 pre-existing hadith collections against IslamicUrduBooks.
--
-- Two RPCs, both scoped to this task:
--
--   scholarly_documents_lookup_by_citation  (read-only)
--     Given [{collection, hadith_number}], returns each row's OWN domain
--     and ar_fingerprint from scholarly_documents -- a scoped, exact lookup.
--
--     This replaces a broken approach tried first: probe_alignment.py was
--     feeding freshly-scraped IUB text into scholarly_documents_check_batch
--     under a fake domain='probe'. That RPC's ar_fingerprint branch searches
--     the fingerprint ACROSS THE WHOLE CORPUS regardless of collection or
--     hadith_number ("EXISTS (... WHERE ar_fingerprint = X AND domain <>
--     'probe')") -- it answers "does this exact wording exist anywhere",
--     which is nearly always true for real hadith text because the same
--     hadith is narrated in multiple collections with identical or
--     near-identical wording. A book could show 80%+ "aligned" purely from
--     cross-collection repetition even if its own Tohed-vs-IUB numbering is
--     completely unrelated -- exactly the failure mode Part 1 exists to
--     catch. The alignment question is specifically "does hadith_number N in
--     THIS Tohed-sourced collection match hadith_number N (or N+k) on IUB",
--     which requires reading THAT SPECIFIC ROW's fingerprint, not a global
--     existence check.
--
--   scholarly_documents_update_citation  (write)
--     Given [{passage_key, source_url, citation_ref_patch}], merges
--     citation_ref_patch into citation_ref, archives the row's CURRENT
--     source_url into citation_ref.original_source_url (only if not already
--     archived, so re-running never clobbers true provenance), and sets
--     source_url to the new IUB deep link. One UPDATE per row via
--     jsonb_to_recordset -- set-based, not a per-row loop.
-- ================================================================

-- ── scholarly_documents_lookup_by_citation ──────────────────────────────────
-- The 25 target collections were ingested by several different pipelines
-- over time (hadith-json, urdu-hadith, tohed-hadith, easyquran-hadith, ...),
-- so the caller cannot reliably pre-know which domain a given slug lives
-- under. Search every domain except islamicurdubooks-hadith itself (so an
-- IUB row already in the corpus is never compared against another IUB row)
-- and return whichever domain the match came from, so the caller learns it
-- rather than having to guess it up front.
--
-- LATERAL join = set-based, not a per-row PL/pgSQL loop -- this needs to run
-- over up to ~2,500 (collection, hadith_number) pairs per book (25 sample
-- points x up to 101 in a +/-50 offset window) across 25 books.
-- id/passage_key/source_url are included alongside the fingerprint fields so
-- backup_citations.py can build its pre-write backup from this same RPC
-- rather than needing a third one just for that.
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
           -- ar_fingerprint is NOT a stored column: it exists only as the
           -- functional expression behind scholarly_documents_ar_fingerprint_idx.
           -- Computed inline with the identical expression so the index stays
           -- usable and the value matches scripts/iub/ar_normalize.py's port.
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
  'Phase E alignment probe: exact (collection, hadith_number) -> (domain, ar_fingerprint) lookup, scoped per row -- NOT a global fingerprint search. Companion to scholarly_documents_check_batch, which is deliberately unscoped for its own (different) purpose.';

-- service_role only: called from ingest-batch, which is already gated by
-- INGEST_SHARED_SECRET.
REVOKE ALL ON FUNCTION public.scholarly_documents_lookup_by_citation(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scholarly_documents_lookup_by_citation(jsonb) TO service_role;


-- ── scholarly_documents_update_citation ─────────────────────────────────────
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
      -- Archive the CURRENT source_url as original_source_url only if it has
      -- not already been archived -- otherwise a second run of the same
      -- apply script would overwrite the true Tohed/EasyHadees origin with
      -- whatever IUB url the first run had just set, destroying provenance
      -- instead of preserving it.
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
      RAISE WARNING 'scholarly_documents_update_citation: passage_key % matched % rows, expected at most 1 (passage_key_idx is not unique-enforced)', v_passage_key, v_rows;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.scholarly_documents_update_citation(jsonb) IS
  'Phase E apply step: patches citation_ref with IUB deep-link fields (iub_url/iub_bookid/iub_path/iub_hadith_number/iub_verified_at) and sets source_url to the new IUB url, archiving the prior source_url into citation_ref.original_source_url exactly once. Called from ingest-batch mode=update-citation, gated by the same x-ingest-secret check.';

REVOKE ALL ON FUNCTION public.scholarly_documents_update_citation(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scholarly_documents_update_citation(jsonb) TO service_role;
