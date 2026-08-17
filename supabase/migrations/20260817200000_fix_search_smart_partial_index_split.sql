-- ================================================================
-- Migration: split search_documents_smart's per-term UNION branch
-- into two single-column branches, so it can actually use the
-- partial trigram indexes.
--
-- ── Problem (confirmed live, 2026-08-17, via new Tier K RPC
--    instrumentation added to islamic-search/index.ts) ─────────────
-- 20260816000000_fix_search_smart_index_usage.sql fixed the
-- outer-candidates filter's *correlation* (moving from a correlated
-- EXISTS to per-term UNION branches), but each branch still combines
-- BOTH columns in one predicate:
--
--   WHERE (normalize_arabic_text(content_ar) ILIKE %L
--          OR lower(content) ILIKE %L)
--
-- Both trigram indexes are PARTIAL:
--   scholarly_documents_content_ar_norm_trgm_idx WHERE content_ar IS NOT NULL
--   scholarly_documents_content_lower_trgm_idx   WHERE content   IS NOT NULL
--
-- A branch's WHERE clause must let Postgres *prove* a partial index's
-- predicate holds for every row the branch can return. An OR of two
-- columns can't prove either column's IS NOT NULL individually, so
-- neither partial index applies and the branch falls back to a
-- sequential scan — one per term, i.e. exactly as slow as the
-- original correlated-EXISTS bug the prior migration set out to fix.
--
-- This was previously diagnosed and hotfixed directly against
-- production on 2026-08-16 (see memory easyeditor-p3-alif-shipped),
-- but that hotfix was never captured as a migration file, so the
-- committed 20260816000000 migration still has the broken combined-OR
-- shape. Whatever ran live afterward drifted out of the repo and,
-- per this session's fresh measurement, is no longer in place —
-- search_documents_smart now hits the 8s statement_timeout (Postgres
-- error 57014) on realistic multi-source_type, multi-term calls
-- (confirmed: 3 source_types × 12 terms, twice, both timing out at
-- ~8.2s and returning zero rows). This migration is the first
-- committed, reproducible fix for that shape, so the repo and
-- production can no longer silently diverge on it again.
--
-- ── Fix ──────────────────────────────────────────────────────────
-- Emit two UNION branches per term instead of one: one restricted to
-- content_ar (repeating that index's own `content_ar IS NOT NULL`
-- predicate), one restricted to content (repeating `content IS NOT
-- NULL`). Each branch is now single-column and index-eligible, same
-- shape search_documents_scoped already uses correctly for its one
-- content_ar-only branch. match_score's correlated subquery is left
-- as-is: it runs once per already-index-bounded candidate row, not
-- as a filter Postgres needs to push into an index scan, so combining
-- both columns there is cheap and was never the bottleneck.
-- ================================================================

CREATE OR REPLACE FUNCTION public.search_documents_smart(
  p_terms        text[],
  p_source_types text[]   DEFAULT NULL,
  p_match_limit  integer  DEFAULT 30
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
AS $function$
DECLARE
  v_term          text;
  v_norm_terms    text[] := ARRAY[]::text[];
  v_union_parts   text[] := ARRAY[]::text[];
  v_source_filter text := '';
  v_sql           text;
BEGIN
  -- Prevent runaway scans; callers already treat a timeout as "no results"
  -- and fall back to other tiers.
  PERFORM set_config('statement_timeout', '8000', true);

  FOREACH v_term IN ARRAY p_terms LOOP
    IF v_term IS NOT NULL AND length(btrim(v_term)) >= 2 THEN
      v_norm_terms := array_append(v_norm_terms, public.normalize_arabic_text(v_term));
    END IF;
  END LOOP;

  IF array_length(v_norm_terms, 1) IS NULL THEN
    RETURN;
  END IF;

  IF p_source_types IS NOT NULL THEN
    v_source_filter := format(' AND sd.source_type = ANY(%L::text[])', p_source_types);
  END IF;

  -- Two indexable, single-column, non-correlated branches per term (one for
  -- content_ar, one for content) — see the header comment for why a branch
  -- combining both columns with OR cannot use either partial trigram index.
  FOREACH v_term IN ARRAY v_norm_terms LOOP
    v_union_parts := array_append(v_union_parts, format(
      $b$(SELECT sd.id FROM public.scholarly_documents sd
          WHERE sd.content_ar IS NOT NULL
            AND public.normalize_arabic_text(sd.content_ar) ILIKE %L%s
          LIMIT %s)$b$,
      '%' || v_term || '%',
      v_source_filter,
      GREATEST(p_match_limit, 1) * 20
    ));
    v_union_parts := array_append(v_union_parts, format(
      $b$(SELECT sd.id FROM public.scholarly_documents sd
          WHERE sd.content IS NOT NULL
            AND lower(sd.content) ILIKE %L%s
          LIMIT %s)$b$,
      '%' || lower(v_term) || '%',
      v_source_filter,
      GREATEST(p_match_limit, 1) * 20
    ));
  END LOOP;

  v_sql := format(
    $q$
    WITH candidates AS (%s),
    scored AS (
      SELECT sd.id, sd.domain, sd.source_type, sd.content, sd.content_ar,
             sd.citation_ref, sd.language, sd.source_url,
             (
               SELECT count(*)::int FROM unnest(%L::text[]) AS t(term)
               WHERE public.normalize_arabic_text(sd.content_ar) ILIKE '%%' || t.term || '%%'
                  OR lower(sd.content) ILIKE '%%' || lower(t.term) || '%%'
             ) AS match_score
      FROM (SELECT DISTINCT id FROM candidates) c
      JOIN public.scholarly_documents sd ON sd.id = c.id
    )
    SELECT id, domain, source_type, content, content_ar, citation_ref, language, source_url, match_score
    FROM scored
    ORDER BY match_score DESC, id
    LIMIT %L
    $q$,
    array_to_string(v_union_parts, ' UNION '),
    v_norm_terms,
    p_match_limit
  );

  RETURN QUERY EXECUTE v_sql;
END;
$function$;

COMMENT ON FUNCTION public.search_documents_smart(text[], text[], integer) IS
  'Diacritic-tolerant search over scholarly_documents. Each term contributes two separate, non-correlated, single-column UNION branches (content_ar, content) so the partial trigram GIN indexes (scholarly_documents_content_ar_norm_trgm_idx, scholarly_documents_content_lower_trgm_idx) can actually be used — a branch combining both columns with OR cannot satisfy either index''s partial-index predicate. Ranks by how many expanded terms match each row.';

GRANT EXECUTE ON FUNCTION public.search_documents_smart(text[], text[], integer) TO authenticated, anon, service_role;
