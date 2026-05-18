
-- Phase 1: openiti-index duplicates (keep earliest)
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY citation_ref->>'openiti_id'
    ORDER BY ingested_at ASC, id ASC
  ) AS rn
  FROM public.scholarly_documents
  WHERE domain = 'openiti-index' AND citation_ref->>'openiti_id' IS NOT NULL
)
DELETE FROM public.scholarly_documents WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Phase 2: exact-content duplicates within (domain, source_type)
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY domain, source_type, md5(content)
    ORDER BY ingested_at ASC, id ASC
  ) AS rn
  FROM public.scholarly_documents
)
DELETE FROM public.scholarly_documents WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Phase 3: unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS scholarly_documents_openiti_id_uidx
  ON public.scholarly_documents ((citation_ref->>'openiti_id'))
  WHERE domain = 'openiti-index' AND citation_ref->>'openiti_id' IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS scholarly_documents_hadith_uidx
  ON public.scholarly_documents (
    (citation_ref->>'collection'),
    (citation_ref->>'hadith_number')
  )
  WHERE domain = 'hadith-json'
    AND citation_ref->>'collection' IS NOT NULL
    AND citation_ref->>'hadith_number' IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS scholarly_documents_tanzil_uidx
  ON public.scholarly_documents (
    (citation_ref->>'surah_number'),
    (citation_ref->>'verse')
  )
  WHERE domain = 'tanzil'
    AND citation_ref->>'surah_number' IS NOT NULL
    AND citation_ref->>'verse' IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS scholarly_documents_content_hash_uidx
  ON public.scholarly_documents (domain, source_type, md5(content));

ANALYZE public.scholarly_documents;
