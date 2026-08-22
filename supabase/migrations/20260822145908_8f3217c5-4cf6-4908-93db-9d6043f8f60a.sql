CREATE INDEX IF NOT EXISTS scholarly_documents_collection_hno_idx
  ON public.scholarly_documents (
    (citation_ref->>'collection'),
    (citation_ref->>'hadith_number')
  )
  WHERE citation_ref->>'collection' IS NOT NULL
    AND citation_ref->>'hadith_number' IS NOT NULL;