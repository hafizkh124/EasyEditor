-- Quran exact citation lookup (surah + verse)
CREATE INDEX IF NOT EXISTS scholarly_documents_quran_citation_idx
  ON scholarly_documents USING btree (
    ((citation_ref->>'surah_number')::int),
    ((citation_ref->>'verse')::int)
  ) WHERE source_type = 'quran';

-- Hadith exact citation lookup (collection + number)
CREATE INDEX IF NOT EXISTS scholarly_documents_hadith_citation_idx
  ON scholarly_documents USING btree (
    (citation_ref->>'collection'),
    (citation_ref->>'hadith_number')
  ) WHERE source_type = 'hadith';

-- Arabic full-text search (simple config — works for Arabic without stemmer)
CREATE INDEX IF NOT EXISTS scholarly_documents_content_ar_fts_idx
  ON scholarly_documents USING gin (
    to_tsvector('simple', coalesce(content_ar, ''))
  ) WHERE content_ar IS NOT NULL;

-- Combined content FTS (for English/Urdu queries)
CREATE INDEX IF NOT EXISTS scholarly_documents_content_fts_idx
  ON scholarly_documents USING gin (
    to_tsvector('simple', coalesce(content, ''))
  );