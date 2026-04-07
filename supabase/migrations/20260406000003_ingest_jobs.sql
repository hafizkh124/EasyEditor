-- ================================================================
-- Migration: ingest_jobs — tracks offline corpus ingestion progress
-- Used by ingest-scholarly-data edge function and CLI ingestion scripts
-- ================================================================

CREATE TABLE IF NOT EXISTS public.ingest_jobs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset     TEXT        NOT NULL,
  -- dataset values: 'tanzil' | 'hadith-json' | 'open-hadith' | 'fawazahmed0'
  --                 | 'shamela' | 'openiti' | 'qul-tafsir'

  status      TEXT        NOT NULL DEFAULT 'pending',
  -- status: 'pending' | 'running' | 'done' | 'error'

  total_rows  INT,
  processed   INT         NOT NULL DEFAULT 0,
  errors      INT         NOT NULL DEFAULT 0,
  started_at  TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  notes       TEXT
);

-- Only service_role can write; authenticated users can read (for admin dashboard)
ALTER TABLE public.ingest_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ingest_jobs_service_role_all"
  ON public.ingest_jobs
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "ingest_jobs_authenticated_read"
  ON public.ingest_jobs
  FOR SELECT TO authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS ingest_jobs_dataset_status_idx
  ON public.ingest_jobs (dataset, status);
