REVOKE ALL ON FUNCTION public.scholarly_documents_lookup_by_citation(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scholarly_documents_update_citation(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scholarly_documents_lookup_by_citation(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.scholarly_documents_update_citation(jsonb) TO service_role;