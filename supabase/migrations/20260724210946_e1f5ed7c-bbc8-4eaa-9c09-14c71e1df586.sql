
CREATE OR REPLACE FUNCTION public.backfill_passage_keys(p_batch int DEFAULT 5000)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n int;
BEGIN
  UPDATE public.scholarly_documents sd
  SET passage_key = 'quran:' || (sd.citation_ref->>'surah_number') || ':' || (sd.citation_ref->>'verse')
  WHERE sd.id IN (
    SELECT d.id FROM public.scholarly_documents d
    WHERE d.passage_key IS NULL
      AND d.citation_ref->>'surah_number' IS NOT NULL
      AND d.citation_ref->>'verse' IS NOT NULL
    LIMIT p_batch
  );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RETURN n; END IF;

  UPDATE public.scholarly_documents sd
  SET passage_key = 'hadith:' || LOWER(COALESCE(sd.citation_ref->>'collection', sd.citation_ref->>'book', 'hadith')) || ':' || (sd.citation_ref->>'hadith_number')
  WHERE sd.id IN (
    SELECT d.id FROM public.scholarly_documents d
    WHERE d.passage_key IS NULL
      AND d.citation_ref->>'hadith_number' IS NOT NULL
    LIMIT p_batch
  );
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_passage_keys(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_passage_keys(int) TO service_role;
