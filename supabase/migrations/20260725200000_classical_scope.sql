-- ================================================================
-- Migration: Tier-2 classical-corpus scope — discipline index +
-- search_classical_scoped RPC.
--
-- The Quran/Hadith path scopes by source_type + collection/surah. Tier-2
-- (Shamela / OpenITI classical books: fiqh, fatwa, tafsir, lughat, rijal,
-- nahw) scopes by citation_ref->>'discipline'. This adds:
--   1. a btree index on that JSON field so discipline filtering is fast, and
--   2. search_classical_scoped — the lexical channel for the classical
--      corpus, mirroring search_documents_scoped's diacritic-tolerant
--      content_ar matching (via normalize_arabic_text) but filtering on
--      discipline and also returning passage_key so the engine can build a
--      stable match_key for dedup/rerank.
--
-- Reads only; nothing here fabricates or mutates corpus text. Safe to apply
-- before any classical rows exist — the RPC simply returns no rows until the
-- corpus is ingested (scripts/classical_to_csv.py + backfill-embeddings).
-- ================================================================

-- ── Discipline index ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS scholarly_documents_discipline_idx
  ON public.scholarly_documents ((citation_ref->>'discipline'));

-- ── search_classical_scoped ──────────────────────────────────────────────────
-- Diacritic-tolerant lexical search over content_ar, scoped to one or more
-- disciplines (fiqh/fatwa/tafsir/lughat/rijal/nahw). Companion to
-- search_documents_scoped (Quran/Hadith); kept separate so the finely-tuned
-- Quran/Hadith path is never disturbed by classical scoping.
CREATE OR REPLACE FUNCTION public.search_classical_scoped(
  p_patterns    text[],
  p_disciplines text[]  DEFAULT NULL,
  p_limit       int     DEFAULT 30
)
RETURNS TABLE (
  id           uuid,
  domain       text,
  source_type  text,
  content      text,
  content_ar   text,
  citation_ref jsonb,
  language     text,
  source_url   text,
  passage_key  text,
  match_score  integer
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS $$
DECLARE
  v_pattern       text;
  v_norm_patterns text[] := ARRAY[]::text[];
BEGIN
  FOREACH v_pattern IN ARRAY p_patterns LOOP
    IF v_pattern IS NOT NULL AND length(btrim(v_pattern)) >= 2 THEN
      v_norm_patterns := array_append(v_norm_patterns, public.normalize_arabic_text(v_pattern));
    END IF;
  END LOOP;

  IF array_length(v_norm_patterns, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    sd.id, sd.domain, sd.source_type, sd.content, sd.content_ar, sd.citation_ref,
    sd.language, sd.source_url, sd.passage_key,
    (
      SELECT count(*)::int
      FROM unnest(v_norm_patterns) AS t(term)
      WHERE public.normalize_arabic_text(sd.content_ar) ILIKE '%' || t.term || '%'
    ) AS match_score
  FROM public.scholarly_documents sd
  WHERE
    sd.content_ar IS NOT NULL
    AND (p_disciplines IS NULL OR (sd.citation_ref->>'discipline') = ANY(p_disciplines))
    AND EXISTS (
      SELECT 1 FROM unnest(v_norm_patterns) AS t(term)
      WHERE public.normalize_arabic_text(sd.content_ar) ILIKE '%' || t.term || '%'
    )
  ORDER BY match_score DESC, sd.id
  LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION public.search_classical_scoped(text[], text[], int) IS
  'Diacritic-tolerant search over scholarly_documents.content_ar for Tier-2 classical corpus, scoped by citation_ref->>''discipline''. Returns passage_key for stable match-key building. Companion to search_documents_scoped (Quran/Hadith).';

GRANT EXECUTE ON FUNCTION public.search_classical_scoped(text[], text[], int)
  TO authenticated, anon, service_role;
