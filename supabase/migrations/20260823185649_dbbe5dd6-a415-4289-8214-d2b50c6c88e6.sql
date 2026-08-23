CREATE OR REPLACE FUNCTION public.scholarly_documents_delete_by_scope(
  p_domain      text,
  p_collections text[]
)
RETURNS TABLE (
  id           uuid,
  passage_key  text,
  source_url   text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_domain IS NULL OR btrim(p_domain) = '' THEN
    RAISE EXCEPTION 'scholarly_documents_delete_by_scope: p_domain is required';
  END IF;
  IF p_collections IS NULL OR array_length(p_collections, 1) IS NULL THEN
    RAISE EXCEPTION 'scholarly_documents_delete_by_scope: p_collections must be a non-empty array (refusing to delete an entire domain)';
  END IF;

  PERFORM set_config('statement_timeout', '60000', true);

  RETURN QUERY
  DELETE FROM public.scholarly_documents sd
  WHERE sd.domain = p_domain
    AND (sd.citation_ref->>'collection') = ANY (p_collections)
  RETURNING sd.id, sd.passage_key, sd.source_url;
END;
$$;

COMMENT ON FUNCTION public.scholarly_documents_delete_by_scope(text, text[]) IS
  'Scoped DELETE keyed on (domain, citation_ref->>collection), both required and non-empty. Built for retiring tohed-hadith rows superseded by a better-sourced copy under a different domain -- domain is required specifically so a shared collection slug across two domains cannot cause a cross-domain delete. Returns id/passage_key/source_url of every deleted row for an audit trail. Called from ingest-batch mode=delete-by-scope, gated by the same x-ingest-secret check as every other ingest RPC.';

REVOKE ALL ON FUNCTION public.scholarly_documents_delete_by_scope(text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scholarly_documents_delete_by_scope(text, text[]) TO service_role;