-- M4 Personal Corpus Database Migration (SPEC-M4 §4.1)

-- 1. Personal Library Chunks
CREATE TABLE IF NOT EXISTS public.library_chunks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  library_item_id UUID NOT NULL REFERENCES public.library_items(id) ON DELETE CASCADE,
  chunk_index     INT  NOT NULL,
  content         TEXT NOT NULL,
  language        TEXT NOT NULL DEFAULT 'ur',
  char_start      INT,
  char_end        INT,
  embedding       VECTOR(768),          -- gemini-embedding-001 @ 768
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (library_item_id, chunk_index)
);

ALTER TABLE public.library_chunks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'library_chunks' AND policyname = 'Users access own chunks'
  ) THEN
    CREATE POLICY "Users access own chunks" ON public.library_chunks
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_library_chunks_item ON public.library_chunks(library_item_id, chunk_index);

-- 2. match_library_chunks RPC — STABLE SECURITY INVOKER (Enforces per-user RLS)
CREATE OR REPLACE FUNCTION public.match_library_chunks(
  query_embedding VECTOR(768),
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
  WHERE embedding IS NOT NULL
    AND (filter_item_ids IS NULL OR library_item_id = ANY(filter_item_ids))
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_library_chunks(VECTOR(768), FLOAT, INT, UUID[]) TO authenticated;
