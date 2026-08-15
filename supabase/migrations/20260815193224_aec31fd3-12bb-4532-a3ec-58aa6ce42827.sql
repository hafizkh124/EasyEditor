-- Follow-up to 20260816000000: the combined OR predicate could not use the
-- PARTIAL trigram indexes (they carry WHERE content_ar IS NOT NULL /
-- WHERE content IS NOT NULL). Verified with EXPLAIN on production:
-- the OR form gave Parallel Seq Scan (33.5s), while each column split into
-- its own branch WITH the matching IS NOT NULL predicate gives a
-- Bitmap Index Scan (<1ms planning, cost ~320). Split accordingly.

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
SET search_path = public
AS $function$
DECLARE
  v_term          text;
  v_norm_terms    text[] := ARRAY[]::text[];
  v_union_parts   text[] := ARRAY[]::text[];
  v_source_filter text := '';
  v_branch_limit  int;
  v_sql           text;
BEGIN
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

  v_branch_limit := GREATEST(p_match_limit, 1) * 20;

  -- Two branches per term, one per partial index. Each branch repeats the
  -- index's own WHERE predicate so the planner can prove the partial index
  -- is applicable.
  FOREACH v_term IN ARRAY v_norm_terms LOOP
    v_union_parts := array_append(v_union_parts, format(
      $b$(SELECT sd.id FROM public.scholarly_documents sd
          WHERE sd.content_ar IS NOT NULL
            AND public.normalize_arabic_text(sd.content_ar) ILIKE %L%s
          LIMIT %s)$b$,
      '%' || v_term || '%', v_source_filter, v_branch_limit
    ));
    v_union_parts := array_append(v_union_parts, format(
      $b$(SELECT sd.id FROM public.scholarly_documents sd
          WHERE sd.content IS NOT NULL
            AND lower(sd.content) ILIKE %L%s
          LIMIT %s)$b$,
      '%' || lower(v_term) || '%', v_source_filter, v_branch_limit
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
SET search_path = public
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

GRANT EXECUTE ON FUNCTION public.search_documents_smart(text[], text[], integer) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.search_documents_scoped(text[], text[], text[], int, int) TO authenticated, anon, service_role;