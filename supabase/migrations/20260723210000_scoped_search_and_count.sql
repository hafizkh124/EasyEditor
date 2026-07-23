-- ================================================================
-- Migration: search_documents_scoped + count_term_occurrences
-- Powers the shared citation engine (_shared/citationEngine.ts).
--
-- Both functions build on public.normalize_arabic_text(), added in
-- 20260517000000_smart_arabic_search.sql — diacritic/letter-variant
-- normalization stays centralized there; this migration only adds
-- scope filtering (collection/surah) and true word-boundary counting
-- on top of it.
-- ================================================================

-- ── search_documents_scoped ──────────────────────────────────────────────────
-- Same diacritic-tolerant matching as search_documents_smart, but:
--   1. matches ONLY content_ar (content mixes Arabic + English translation —
--      matching against it lets English text add noise to an Arabic-term search)
--   2. accepts a collection/surah scope so "قتال in Sahih Bukhari" can actually
--      be restricted to Bukhari instead of searching the whole corpus
CREATE OR REPLACE FUNCTION public.search_documents_scoped(
  p_patterns     text[],
  p_source_types text[]  DEFAULT NULL,
  p_collections  text[]  DEFAULT NULL,
  p_surah        int     DEFAULT NULL,
  p_limit        int     DEFAULT 30
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
    sd.language, sd.source_url,
    (
      SELECT count(*)::int
      FROM unnest(v_norm_patterns) AS t(term)
      WHERE public.normalize_arabic_text(sd.content_ar) ILIKE '%' || t.term || '%'
    ) AS match_score
  FROM public.scholarly_documents sd
  WHERE
    sd.content_ar IS NOT NULL
    AND (p_source_types IS NULL OR sd.source_type = ANY(p_source_types))
    AND (p_collections  IS NULL OR (sd.citation_ref->>'collection') = ANY(p_collections))
    AND (p_surah         IS NULL OR (sd.citation_ref->>'surah_number')::int = p_surah)
    AND EXISTS (
      SELECT 1 FROM unnest(v_norm_patterns) AS t(term)
      WHERE public.normalize_arabic_text(sd.content_ar) ILIKE '%' || t.term || '%'
    )
  ORDER BY match_score DESC, sd.id
  LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION public.search_documents_scoped(text[], text[], text[], int, int) IS
  'Diacritic-tolerant search over scholarly_documents.content_ar only, with optional collection/surah scoping. Companion to search_documents_smart (which also matches content and has no scope filter).';

GRANT EXECUTE ON FUNCTION public.search_documents_scoped(text[], text[], text[], int, int)
  TO authenticated, anon, service_role;


-- ── escape_arabic_regex ──────────────────────────────────────────────────────
-- Small helper so count_term_occurrences can safely embed a caller-supplied
-- term inside a POSIX ARE pattern without the term's own characters being
-- interpreted as regex metacharacters.
CREATE OR REPLACE FUNCTION public.escape_arabic_regex(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT regexp_replace(t, '([.^$|()\[\]{}*+?\\])', '\\\1', 'g');
$$;

COMMENT ON FUNCTION public.escape_arabic_regex(text) IS
  'Escapes POSIX ARE metacharacters so a raw term can be safely interpolated into a regexp pattern.';

GRANT EXECUTE ON FUNCTION public.escape_arabic_regex(text) TO authenticated, anon, service_role;


-- ── count_term_occurrences ───────────────────────────────────────────────────
-- Counts how many times each of p_patterns occurs as a WHOLE WORD (using
-- Postgres's \m / \M word-boundary constraint escapes — Arabic letters are
-- classified as word characters under the database's UTF8 ctype) inside
-- content_ar, grouped per surah (Quran) or per collection (Hadith).
--
-- Proclitic handling: Arabic attaches single-letter prefixes directly to the
-- next word with no space (و "and", ف "so", ب "with/by", ل "for", ك "like").
-- A naive whole-word match would miss "وموسى" ("and Musa") entirely, since
-- "موسى" isn't a standalone word there. So every pattern is matched either
-- bare OR with exactly one of those five letters attached, optionally
-- followed by the definite article ال (والقتال, بالقتال, ...).
--
-- The proclitic SET IS HARD-CODED HERE, never caller-supplied — a caller
-- (including an LLM-produced query plan) can only choose WHICH words to
-- count, never inject arbitrary regex syntax.
--
-- p_exclude_definite_article: proper nouns (names) don't grammatically take
-- the definite article — "الموسى" ("the razor", a common noun) is a
-- different word from "موسى" (the name Musa) despite the same letters. When
-- true, occurrences that carry the ال prefix are subtracted out, so a count
-- of a NAME doesn't get inflated by an unrelated common-noun homograph. The
-- caller (query planner) decides per-query whether the target is a name;
-- leaving it false (the default) counts every surface form, which is what
-- you want for an ordinary noun like قتال.
CREATE OR REPLACE FUNCTION public.count_term_occurrences(
  p_patterns                 text[],
  p_source_types             text[]  DEFAULT NULL,
  p_collections               text[] DEFAULT NULL,
  p_surah                    int     DEFAULT NULL,
  p_exclude_definite_article boolean DEFAULT false
)
RETURNS TABLE (
  source_type  text,
  bucket_key   text,
  bucket_label text,
  occurrences  bigint,
  rows_matched bigint
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS $$
DECLARE
  v_term         text;
  v_terms        text[] := ARRAY[]::text[];
  v_alt_all      text[] := ARRAY[]::text[];
  v_alt_def      text[] := ARRAY[]::text[];
  v_pattern_all  text;
  v_pattern_def  text;
BEGIN
  FOREACH v_term IN ARRAY p_patterns LOOP
    IF v_term IS NOT NULL AND length(btrim(v_term)) >= 2 THEN
      v_terms := array_append(
        v_terms,
        public.escape_arabic_regex(public.normalize_arabic_text(v_term))
      );
    END IF;
  END LOOP;

  IF array_length(v_terms, 1) IS NULL THEN
    RETURN;
  END IF;

  FOREACH v_term IN ARRAY v_terms LOOP
    -- bare term, OR one proclitic + optional ال, OR bare ال + term
    v_alt_all := array_append(v_alt_all, '(ال|[وفبلك](ال)?)?' || v_term);
    -- definite-article-only variant, for the subtraction above
    v_alt_def := array_append(v_alt_def, '(ال|[وفبلك]ال)'     || v_term);
  END LOOP;

  v_pattern_all := '\m(' || array_to_string(v_alt_all, '|') || ')\M';
  v_pattern_def := '\m(' || array_to_string(v_alt_def, '|') || ')\M';

  RETURN QUERY
  WITH scoped AS (
    SELECT
      sd.source_type,
      sd.citation_ref,
      public.normalize_arabic_text(sd.content_ar) AS norm_text
    FROM public.scholarly_documents sd
    WHERE sd.content_ar IS NOT NULL
      AND (p_source_types IS NULL OR sd.source_type = ANY(p_source_types))
      AND (p_collections  IS NULL OR (sd.citation_ref->>'collection') = ANY(p_collections))
      AND (p_surah         IS NULL OR (sd.citation_ref->>'surah_number')::int = p_surah)
  ),
  counted AS (
    SELECT
      s.source_type,
      CASE
        WHEN s.source_type = 'quran'  THEN coalesce(s.citation_ref->>'surah_number', 'unknown')
        WHEN s.source_type = 'hadith' THEN coalesce(s.citation_ref->>'collection', 'unknown')
        ELSE coalesce(s.source_type, 'unknown')
      END AS bucket_key,
      CASE
        WHEN s.source_type = 'quran'  THEN coalesce(s.citation_ref->>'surah_name', 'Unknown')
        WHEN s.source_type = 'hadith' THEN coalesce(
          s.citation_ref->>'book_en', s.citation_ref->>'book',
          s.citation_ref->>'collection', 'Unknown'
        )
        ELSE coalesce(s.source_type, 'Unknown')
      END AS bucket_label,
      -- Outer GREATEST(...,0) guards against a negative result in the
      -- (should-not-happen, but unproven) case where the "definite" pattern
      -- somehow matches more often on a given row than the permissive one.
      GREATEST(
        GREATEST(array_length(regexp_split_to_array(s.norm_text, v_pattern_all), 1) - 1, 0)
        - CASE WHEN p_exclude_definite_article THEN
            GREATEST(array_length(regexp_split_to_array(s.norm_text, v_pattern_def), 1) - 1, 0)
          ELSE 0 END,
        0
      ) AS occ
    FROM scoped s
    WHERE s.norm_text ~ v_pattern_all
  )
  SELECT
    c.source_type,
    c.bucket_key,
    c.bucket_label,
    SUM(c.occ)::bigint                          AS occurrences,
    COUNT(*) FILTER (WHERE c.occ > 0)::bigint    AS rows_matched
  FROM counted c
  GROUP BY c.source_type, c.bucket_key, c.bucket_label
  HAVING SUM(c.occ) > 0
  ORDER BY occurrences DESC;
END;
$$;

COMMENT ON FUNCTION public.count_term_occurrences(text[], text[], text[], int, boolean) IS
  'Whole-word occurrence counts for Arabic terms across scholarly_documents.content_ar, bucketed per surah (Quran) or collection (Hadith). See in-function comments for the proclitic and definite-article-exclusion design.';

GRANT EXECUTE ON FUNCTION public.count_term_occurrences(text[], text[], text[], int, boolean)
  TO authenticated, anon, service_role;
