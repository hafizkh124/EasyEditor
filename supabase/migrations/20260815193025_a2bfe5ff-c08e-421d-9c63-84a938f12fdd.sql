-- ================================================================
-- Migration: fix search_documents_smart / search_documents_scoped
-- to actually use the trigram indexes added in
-- 20260721094011_bb9962f2-9676-45d2-9c8c-342b7ec9c723.sql
--
-- ── Problem (confirmed live against production, 2026-08-16) ────────────────
-- Both RPCs filter with a correlated subquery:
--
--   WHERE EXISTS (
--     SELECT 1 FROM unnest(v_norm_terms) AS t(term)
--     WHERE normalize_arabic_text(sd.content_ar) ILIKE '%' || t.term || '%'
--        OR lower(sd.content) ILIKE '%' || lower(t.term) || '%'
--   )
--
-- `sd` is the OUTER row here — the ILIKE pattern is only known per outer
-- row, inside a correlated subquery. Postgres cannot push a correlated
-- subquery's predicate into an index scan on the outer table, so this
-- degrades to a full sequential scan of scholarly_documents for every call,
-- regardless of the trigram GIN indexes that exist on
-- normalize_arabic_text(content_ar) and lower(content).
--
-- This was fine at ~95K rows (the scale noted in the original migration's
-- comment, ~400-800ms). At the corpus's current size — 373,128 rows — a
-- term that doesn't happen to match early in physical row order now exceeds
-- the 8s statement_timeout and the RPC returns a 500 instead of results.
-- Confirmed empirically: a common term ("طلاق") returned in ~500ms (the
-- LIMIT is satisfied from early rows before the full scan finishes); a
-- rare/no-match term ("ابرار الرحمن") timed out at 8s — the OPPOSITE of what
-- an index-driven search would show, and the tell that no index is in play.
--
-- Every caller of this RPC treats a timeout/error identically to "no
-- results" (search_documents_smart is wrapped in try/catch in
-- islamic-search/index.ts, citationCandidates.ts, and citationEngine.ts) —
-- so this failure has been silent everywhere it happens: an editor typing a
-- less-common phrase, or a citation lookup for specific wording, just gets
-- back "no sources found" with no indication that the search itself broke.
--
-- ── Fix ──────────────────────────────────────────────────────────────────
-- Restructure both RPCs so each term is a literal, non-correlated ILIKE
-- predicate the planner can see directly against scholarly_documents — one
-- UNION branch per term. Each branch is then eligible for the existing
-- trigram GIN indexes via a bitmap index scan; Postgres combines the
-- per-term bitmaps (BitmapOr) instead of scanning the table once per row.
-- match_score is computed afterward, only over the (now index-bounded)
-- candidate set, exactly as before.
--
-- NOTE: this migration was authored and reviewed but NOT applied to
-- production from this session — no Supabase CLI login/DB credentials were
-- available here. Deploy with `supabase db push` (or paste into the SQL
-- editor) and confirm with EXPLAIN that a Bitmap Index Scan appears instead
-- of a Seq Scan, then re-run the rare-term timing check to confirm parity
-- with common-term latency.
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

  -- One indexable, non-correlated branch per term. Each branch is
  -- parenthesized — without that, a LIMIT on a non-final arm of a UNION
  -- chain is a syntax error / binds to the wrong arm in Postgres's grammar.
  FOREACH v_term IN ARRAY v_norm_terms LOOP
    v_union_parts := array_append(v_union_parts, format(
      $b$(SELECT sd.id FROM public.scholarly_documents sd
          WHERE (public.normalize_arabic_text(sd.content_ar) ILIKE %L
                 OR lower(sd.content) ILIKE %L)%s
          LIMIT %s)$b$,
      '%' || v_term || '%',
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
  'Diacritic-tolerant search over scholarly_documents. Each term is a separate, non-correlated UNION branch so the trigram GIN indexes (scholarly_documents_content_ar_norm_trgm_idx, scholarly_documents_content_lower_trgm_idx) can actually be used — the prior correlated-EXISTS shape could not use them and fell back to a full scan. Ranks by how many expanded terms match each row.';


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
AS $function$
DECLARE
  v_pattern        text;
  v_norm_patterns  text[] := ARRAY[]::text[];
  v_union_parts    text[] := ARRAY[]::text[];
  v_scope_filter   text := '';
  v_sql            text;
BEGIN
  PERFORM set_config('statement_timeout', '8000', true);

  FOREACH v_pattern IN ARRAY p_patterns LOOP
    IF v_pattern IS NOT NULL AND length(btrim(v_pattern)) >= 2 THEN
      v_norm_patterns := array_append(v_norm_patterns, public.normalize_arabic_text(v_pattern));
    END IF;
  END LOOP;

  IF array_length(v_norm_patterns, 1) IS NULL THEN
    RETURN;
  END IF;

  IF p_source_types IS NOT NULL THEN
    v_scope_filter := v_scope_filter || format(' AND sd.source_type = ANY(%L::text[])', p_source_types);
  END IF;
  IF p_collections IS NOT NULL THEN
    v_scope_filter := v_scope_filter || format(' AND (sd.citation_ref->>%L) = ANY(%L::text[])', 'collection', p_collections);
  END IF;
  IF p_surah IS NOT NULL THEN
    v_scope_filter := v_scope_filter || format(' AND (sd.citation_ref->>%L)::int = %L', 'surah_number', p_surah);
  END IF;

  FOREACH v_pattern IN ARRAY v_norm_patterns LOOP
    v_union_parts := array_append(v_union_parts, format(
      $b$(SELECT sd.id FROM public.scholarly_documents sd
          WHERE sd.content_ar IS NOT NULL
            AND public.normalize_arabic_text(sd.content_ar) ILIKE %L%s
          LIMIT %s)$b$,
      '%' || v_pattern || '%',
      v_scope_filter,
      GREATEST(p_limit, 1) * 20
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
    v_norm_patterns,
    p_limit
  );

  RETURN QUERY EXECUTE v_sql;
END;
$function$;

COMMENT ON FUNCTION public.search_documents_scoped(text[], text[], text[], int, int) IS
  'Diacritic-tolerant search over scholarly_documents.content_ar only, with optional collection/surah scoping. Each pattern is a separate, non-correlated UNION branch so the trigram GIN index can be used — see search_documents_smart for why the prior correlated-EXISTS shape could not. Companion to search_documents_smart (which also matches content and has no scope filter).';

GRANT EXECUTE ON FUNCTION public.search_documents_smart(text[], text[], integer) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.search_documents_scoped(text[], text[], text[], int, int) TO authenticated, anon, service_role;