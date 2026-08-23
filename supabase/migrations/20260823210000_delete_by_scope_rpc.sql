-- ================================================================
-- scholarly_documents_delete_by_scope(p_domain text, p_collections text[])
--
-- Scoped, service-role-only DELETE. Built to retire the 11 tohed-hadith-only
-- books once a superior IUB copy (full tashkeel matn, hukm, takhreej, isnad
-- chain) replaces them -- see the 2026-08-23 Arabic-gap backfill.
--
-- SAFETY, not convenience, is why this takes p_domain rather than deleting
-- by collection alone: 9 of the 11 replaced books share their exact
-- collection slug between the old tohed-hadith rows and the new
-- islamicurdubooks-hadith rows (e.g. both are "sahih-ibn-hibban" --
-- collections.ts's arabicMatn split already documents this). A collection-
-- only filter would delete the brand-new rows in the same statement as the
-- old ones. Requiring domain = 'tohed-hadith' makes that impossible: the two
-- copies are different rows in a different domain regardless of whether
-- their collection string collides.
--
-- p_collections has no DEFAULT and is never allowed to be empty or NULL --
-- "delete everything in a domain" is not a use case this function serves,
-- deliberately, so a caller cannot wipe tohed-hadith's OTHER 3 books
-- (musannaf-ibn-abi-shaybah, mishkat-al-masabih, sahih-adab-al-mufrad, which
-- keep their tohed-hadith copy because a different domain already carries
-- their Arabic) by a missing argument.
--
-- Returns the deleted rows' own passage_key/source_url so the caller can
-- write an audit log without a second round trip. The actual backup is
-- data/tohed_hadiths.csv, already on disk with full content for every row
-- this can delete -- this function does not create one itself.
-- ================================================================

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
