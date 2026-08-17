-- Keep the index-eligible single-column candidate branches introduced by
-- 20260817200000, but carry each matching term's ordinal through the UNION.
-- This avoids re-running every normalized ILIKE expression against every
-- candidate's full text merely to calculate match_score.

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
  v_term_no       integer := 0;
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

  FOREACH v_term IN ARRAY v_norm_terms LOOP
    v_term_no := v_term_no + 1;
    v_union_parts := array_append(v_union_parts, format(
      $b$(SELECT sd.id, %s::integer AS term_no
          FROM public.scholarly_documents sd
          WHERE sd.content_ar IS NOT NULL
            AND public.normalize_arabic_text(sd.content_ar) ILIKE %L%s
          LIMIT %s)$b$,
      v_term_no,
      '%' || v_term || '%',
      v_source_filter,
      GREATEST(p_match_limit, 1) * 20
    ));
    v_union_parts := array_append(v_union_parts, format(
      $b$(SELECT sd.id, %s::integer AS term_no
          FROM public.scholarly_documents sd
          WHERE sd.content IS NOT NULL
            AND lower(sd.content) ILIKE %L%s
          LIMIT %s)$b$,
      v_term_no,
      '%' || lower(v_term) || '%',
      v_source_filter,
      GREATEST(p_match_limit, 1) * 20
    ));
  END LOOP;

  v_sql := format(
    $q$
    WITH candidates AS (%s),
    scored AS (
      SELECT id, count(DISTINCT term_no)::integer AS match_score
      FROM candidates
      GROUP BY id
    )
    SELECT sd.id, sd.domain, sd.source_type, sd.content, sd.content_ar,
           sd.citation_ref, sd.language, sd.source_url, scored.match_score
    FROM scored
    JOIN public.scholarly_documents sd ON sd.id = scored.id
    ORDER BY scored.match_score DESC, sd.id
    LIMIT %L
    $q$,
    array_to_string(v_union_parts, ' UNION ALL '),
    p_match_limit
  );

  RETURN QUERY EXECUTE v_sql;
END;
$function$;

COMMENT ON FUNCTION public.search_documents_smart(text[], text[], integer) IS
  'Index-backed diacritic-tolerant search. Arabic and translated text use separate partial-index-eligible branches; matching term ordinals are carried through the candidate UNION so ranking does not rescan full document text.';

GRANT EXECUTE ON FUNCTION public.search_documents_smart(text[], text[], integer) TO authenticated, anon, service_role;