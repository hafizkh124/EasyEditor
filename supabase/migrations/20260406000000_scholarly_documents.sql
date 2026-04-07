-- ================================================================
-- Migration: scholarly_documents + match_scholarly_documents RPC
-- Corpus: Tanzil Quran, hadith-json, Open-Hadith-Data, Shamela, OpenITI
-- Requires: pgvector extension (enable in Supabase dashboard first)
-- ================================================================

-- Enable pgvector (safe to run even if already enabled)
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Main corpus table ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scholarly_documents (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  domain       TEXT        NOT NULL,
  -- domain values: 'tanzil' | 'hadith-json' | 'open-hadith' | 'fawazahmed0'
  --               | 'shamela' | 'openiti' | 'qul-tafsir' | 'islamqa-cache'

  source_type  TEXT        NOT NULL,
  -- source_type: 'quran' | 'hadith' | 'tafsir' | 'fatwa' | 'classical' | 'article'

  title        TEXT,
  content      TEXT        NOT NULL,  -- Merged Arabic + English; primary searchable text
  content_ar   TEXT,                  -- Arabic original stored separately if needed

  citation_ref JSONB       NOT NULL DEFAULT '{}',
  -- Quran:    { "surah_number":2, "surah_name":"البقرة", "verse":255, "juz":3 }
  -- Hadith:   { "book":"Bukhari", "collection":"bukhari", "hadith_number":7,
  --             "grade":"Sahih", "rawi":"Abu Huraira", "volume":1, "page":12 }
  -- Tafsir:   { "surah":1, "verse":1, "mufassir":"Ibn Kathir", "source":"qul" }
  -- Fatwa:    { "site":"islamqa.info", "fatwa_number":"12345",
  --             "scholar":"...", "url":"https://..." }
  -- Classical:{ "openiti_id":"...", "author":"...", "title":"...",
  --             "volume":2, "page":45 }

  language     TEXT        NOT NULL DEFAULT 'ar',  -- 'ar' | 'en' | 'ur'
  embedding    VECTOR(768),                         -- text-embedding-004 (768 dims)
  source_url   TEXT,
  ingested_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE public.scholarly_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scholarly_documents_authenticated_read"
  ON public.scholarly_documents
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "scholarly_documents_service_role_insert"
  ON public.scholarly_documents
  FOR INSERT TO service_role
  WITH CHECK (true);

-- Allow service_role to update embeddings after ingestion
CREATE POLICY "scholarly_documents_service_role_update"
  ON public.scholarly_documents
  FOR UPDATE TO service_role
  USING (true)
  WITH CHECK (true);

-- ── Indexes ──────────────────────────────────────────────────────────────────
-- IVFFlat cosine index for vector similarity search (Free tier).
-- lists = 100 is a safe starting point; tune to sqrt(row_count) after full ingestion.
-- Swap to HNSW when upgrading to Supabase Pro (see Phase 4 in roadmap).
-- NOTE: This index can only be created AFTER data is ingested (IVFFlat needs rows to cluster).
-- Run this manually after the first bulk import:
--   CREATE INDEX scholarly_documents_embedding_idx
--     ON public.scholarly_documents
--     USING ivfflat (embedding vector_cosine_ops)
--     WITH (lists = 100);
-- For now create a plain btree index on domain/type for filtering:
CREATE INDEX IF NOT EXISTS scholarly_documents_domain_type_idx
  ON public.scholarly_documents (domain, source_type);

CREATE INDEX IF NOT EXISTS scholarly_documents_language_idx
  ON public.scholarly_documents (language);

-- ── Deduplication unique indexes ─────────────────────────────────────────────
-- Prevents re-ingesting the same hadith from multiple import runs
CREATE UNIQUE INDEX IF NOT EXISTS scholarly_documents_hadith_dedup
  ON public.scholarly_documents ((citation_ref->>'hadith_number'), (citation_ref->>'book'))
  WHERE domain IN ('hadith-json', 'open-hadith', 'fawazahmed0');

-- Prevents duplicate Quran verses from Tanzil re-imports
CREATE UNIQUE INDEX IF NOT EXISTS scholarly_documents_quran_dedup
  ON public.scholarly_documents ((citation_ref->>'surah_number'), (citation_ref->>'verse'))
  WHERE domain = 'tanzil';

-- ── match_scholarly_documents RPC ────────────────────────────────────────────
-- Called by the vector-search edge function.
-- Returns documents ordered by cosine similarity above threshold.
CREATE OR REPLACE FUNCTION public.match_scholarly_documents(
  query_embedding  VECTOR(768),
  match_threshold  FLOAT   DEFAULT 0.6,
  match_count      INT     DEFAULT 8,
  filter_domains   TEXT[]  DEFAULT NULL,
  filter_language  TEXT    DEFAULT NULL
)
RETURNS TABLE (
  id           UUID,
  domain       TEXT,
  source_type  TEXT,
  title        TEXT,
  content      TEXT,
  citation_ref JSONB,
  language     TEXT,
  source_url   TEXT,
  similarity   FLOAT
)
LANGUAGE sql STABLE AS $$
  SELECT
    id, domain, source_type, title, content, citation_ref, language, source_url,
    1 - (embedding <=> query_embedding) AS similarity
  FROM public.scholarly_documents
  WHERE embedding IS NOT NULL
    AND (filter_domains IS NULL OR domain = ANY(filter_domains))
    AND (filter_language IS NULL OR language = filter_language)
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_scholarly_documents(
  VECTOR(768), FLOAT, INT, TEXT[], TEXT
) TO authenticated;

-- ── Corpus row count helper (admin / monitoring) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.scholarly_documents_stats()
RETURNS TABLE (domain TEXT, source_type TEXT, total BIGINT, embedded BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    domain,
    source_type,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS embedded
  FROM public.scholarly_documents
  GROUP BY domain, source_type
  ORDER BY domain, source_type;
$$;

GRANT EXECUTE ON FUNCTION public.scholarly_documents_stats() TO authenticated;
