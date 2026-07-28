-- M4 fix: make match_library_chunks filter by owner in SQL (SPEC-M4 NFR-5, R2).
--
-- The original signature relied on `SECURITY INVOKER` + the owner-only RLS
-- policy on library_chunks. That is correct for a browser client, but every
-- edge function that reaches this RPC (refine-text, resource-search) builds
-- its client with the SERVICE ROLE key — and service_role bypasses RLS. The
-- function therefore searched EVERY user's private books and returned
-- passages from other people's uploads.
--
-- The owner is now an explicit, non-defaulted argument and the predicate
-- lives in the query itself, so the guarantee no longer depends on which key
-- the caller happened to use. NULL returns nothing (fail closed).

DROP FUNCTION IF EXISTS public.match_library_chunks(VECTOR(768), FLOAT, INT, UUID[]);

CREATE OR REPLACE FUNCTION public.match_library_chunks(
  query_embedding VECTOR(768),
  filter_user_id  UUID,
  match_threshold FLOAT DEFAULT 0.6,
  match_count     INT   DEFAULT 8,
  filter_item_ids UUID[] DEFAULT NULL
) RETURNS TABLE (
  id UUID,
  library_item_id UUID,
  chunk_index INT,
  content TEXT,
  language TEXT,
  meta JSONB,
  similarity FLOAT
) LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT id, library_item_id, chunk_index, content, language, meta,
         1 - (embedding <=> query_embedding) AS similarity
  FROM public.library_chunks
  WHERE filter_user_id IS NOT NULL
    AND user_id = filter_user_id
    AND embedding IS NOT NULL
    AND (filter_item_ids IS NULL OR library_item_id = ANY(filter_item_ids))
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_library_chunks(VECTOR(768), UUID, FLOAT, INT, UUID[]) TO authenticated;
