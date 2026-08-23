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
    v_patch       := COALESCE(r->'citation_ref_patch', '{}'::jsonb);
    IF v_patch = 'null'::jsonb THEN
      v_patch := '{}'::jsonb;
    END IF;

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
  'In-place content UPDATE keyed on passage_key, with an optional citation_ref merge. Companion to scholarly_documents_update_citation, which cannot touch content. Idempotent; refuses a blank content; leaves source_url and embedding alone. Called from ingest-batch mode=update-content, gated by the same x-ingest-secret check.';

REVOKE ALL ON FUNCTION public.scholarly_documents_update_content(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scholarly_documents_update_content(jsonb) TO service_role;