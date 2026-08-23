-- ================================================================
-- scholarly_documents_update_content(payload jsonb)
--
-- In-place UPDATE of `content` (plus an optional citation_ref merge) keyed on
-- passage_key. Companion to scholarly_documents_update_citation
-- (20260820000000), which can only patch citation_ref and source_url.
--
-- WHY: a scraper can be wrong about WHAT it extracted, not just about where a
-- row points. scrape_rijal.py read only <td>label</td><td>value</td> pairs, so
-- all 19,616 narrator rows captured the جرح و تعدیل verdicts and silently
-- dropped the per-book narration counts ("مسند احمد (438)") that sit in a
-- separate link strip on the same page. Those counts are the single most
-- common thing asked about a narrator, and `content` is the only field the
-- model actually reads (buildContextBlock in islamic-search renders
-- citation_ref as a one-line REFERENCE and nothing more) — so fixing this
-- needs a content UPDATE, which no existing RPC could do.
--
-- Idempotent: content is SET, never appended, so re-running a backfill after
-- a partial failure converges rather than duplicating text.
--
-- Deliberately does NOT touch source_url or embedding:
--   * source_url is Phase E's business (see update_citation's archiving rule);
--     conflating the two would let a content fix quietly rewrite provenance.
--   * embedding is left stale on purpose. For rijal the vector is built from
--     the biography text and that is how the row gets FOUND; the counts only
--     need to be present once it has been. Re-embedding 19,616 rows to add a
--     list of numbers would spend real Gemini quota for no retrieval gain.
--     backfill-embeddings only picks up rows WHERE embedding IS NULL, so this
--     does not silently enqueue them either.
-- ================================================================

CREATE OR REPLACE FUNCTION public.scholarly_documents_update_content(payload jsonb)
RETURNS TABLE (
  passage_key text,
  updated     boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r             jsonb;
  v_passage_key text;
  v_content     text;
  v_patch       jsonb;
  v_rows        int;
BEGIN
  PERFORM set_config('statement_timeout', '60000', true);

  FOR r IN SELECT value FROM jsonb_array_elements(payload) AS t(value)
  LOOP
    v_passage_key := r->>'passage_key';
    v_content     := r->>'content';
    -- Optional. `r->'citation_ref_patch'` is SQL NULL when absent and JSON
    -- 'null' when explicitly null; COALESCE to an empty object so the merge
    -- below is a no-op in both cases rather than nulling the whole column.
    v_patch       := COALESCE(r->'citation_ref_patch', '{}'::jsonb);
    IF v_patch = 'null'::jsonb THEN
      v_patch := '{}'::jsonb;
    END IF;

    -- A blank content would erase the row. Refuse rather than "succeed".
    IF v_passage_key IS NULL OR v_content IS NULL OR btrim(v_content) = '' THEN
      passage_key := v_passage_key;
      updated := false;
      RETURN NEXT;
      CONTINUE;
    END IF;

    UPDATE public.scholarly_documents sd
    SET
      content      = v_content,
      citation_ref = COALESCE(sd.citation_ref, '{}'::jsonb) || v_patch
    WHERE sd.passage_key = v_passage_key;

    GET DIAGNOSTICS v_rows = ROW_COUNT;

    passage_key := v_passage_key;
    updated := v_rows > 0;
    RETURN NEXT;

    IF v_rows > 1 THEN
      RAISE WARNING 'scholarly_documents_update_content: passage_key % matched % rows, expected at most 1 (passage_key_idx is not unique-enforced)', v_passage_key, v_rows;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.scholarly_documents_update_content(jsonb) IS
  'In-place content UPDATE keyed on passage_key, with an optional citation_ref merge. Companion to scholarly_documents_update_citation, which cannot touch content. Built for the rijal narration-count backfill (scrape_rijal.py had never extracted the per-book counts). Idempotent; refuses a blank content; leaves source_url and embedding alone. Called from ingest-batch mode=update-content, gated by the same x-ingest-secret check.';

REVOKE ALL ON FUNCTION public.scholarly_documents_update_content(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scholarly_documents_update_content(jsonb) TO service_role;
