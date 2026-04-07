-- ================================================================
-- RUN THIS IN: Supabase Dashboard → SQL Editor → New Query
-- Purpose: Fix 400 errors on admin subscription updates
-- Safe to run multiple times (fully idempotent)
-- ================================================================


-- ── STEP 1: Add missing columns ─────────────────────────────
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS tts_character_limit     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tts_characters_used     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ocr_pages_limit         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ocr_pages_used          integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS research_queries_limit  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS research_queries_used   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS upgrade_requested       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pending_tier            text,
  ADD COLUMN IF NOT EXISTS payment_reference       text,
  ADD COLUMN IF NOT EXISTS last_upgrade_request    timestamptz;


-- ── STEP 2: Add missing enum values ─────────────────────────
-- NOTE: These must run OUTSIDE a transaction on some Postgres versions.
-- If you get an error, run each ALTER TYPE line separately.
ALTER TYPE public.subscription_tier ADD VALUE IF NOT EXISTS 'basic';
ALTER TYPE public.subscription_tier ADD VALUE IF NOT EXISTS 'ultra';


-- ── STEP 3: Admin RLS — allow admin to UPDATE any subscription
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'subscriptions'
      AND policyname = 'admins_can_update_any_subscription'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY admins_can_update_any_subscription
        ON public.subscriptions
        FOR UPDATE
        TO authenticated
        USING (
          EXISTS (
            SELECT 1 FROM public.user_roles
            WHERE user_id = auth.uid() AND role = 'admin'
          )
        )
        WITH CHECK (
          EXISTS (
            SELECT 1 FROM public.user_roles
            WHERE user_id = auth.uid() AND role = 'admin'
          )
        )
    $policy$;
  END IF;
END
$$;


-- ── STEP 4: Admin RLS — allow admin to UPDATE any profile ────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'profiles'
      AND policyname = 'admins_can_update_any_profile'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY admins_can_update_any_profile
        ON public.profiles
        FOR UPDATE
        TO authenticated
        USING (
          EXISTS (
            SELECT 1 FROM public.user_roles
            WHERE user_id = auth.uid() AND role = 'admin'
          )
        )
        WITH CHECK (
          EXISTS (
            SELECT 1 FROM public.user_roles
            WHERE user_id = auth.uid() AND role = 'admin'
          )
        )
    $policy$;
  END IF;
END
$$;


-- ── STEP 5: Rebuild handle_new_user ─────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  )
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.subscriptions (
    user_id, tier,
    transcription_limit, tts_character_limit,
    ocr_pages_limit, research_queries_limit
  )
  VALUES (NEW.id, 'free', 0, 0, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ── STEP 6: Rebuild auto_pro_for_admin ──────────────────────
CREATE OR REPLACE FUNCTION public.auto_pro_for_admin()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = NEW.user_id AND role = 'admin'
  ) THEN
    INSERT INTO public.subscriptions (
      user_id, tier,
      transcription_limit, tts_character_limit,
      ocr_pages_limit, research_queries_limit
    )
    VALUES (NEW.user_id, 'ultra', 54000, 1000000, 5000, 1000)
    ON CONFLICT (user_id) DO UPDATE SET
      tier                   = 'ultra',
      transcription_limit    = 54000,
      tts_character_limit    = 1000000,
      ocr_pages_limit        = 5000,
      research_queries_limit = 1000;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ── STEP 7: Verify — check existing policies & enum values ──
-- ── STEP 7: Atomic increment RPC for research queries ───────
CREATE OR REPLACE FUNCTION public.increment_research_queries(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.subscriptions
  SET research_queries_used = research_queries_used + 1
  WHERE user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_research_queries(uuid) TO authenticated;


-- ── Islamic Research Query Tracking (Migration 20260406000002) ──────────────
-- Add Islamic research query tracking columns to subscriptions
-- Separate from the general research_queries_* columns

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS islamic_queries_used  INT4 NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS islamic_queries_limit INT4 NOT NULL DEFAULT 0;

-- Set default limits per tier for existing rows
UPDATE public.subscriptions SET islamic_queries_limit = 10  WHERE tier = 'basic';
UPDATE public.subscriptions SET islamic_queries_limit = 100 WHERE tier = 'pro';
UPDATE public.subscriptions SET islamic_queries_limit = 500 WHERE tier = 'ultra';

-- Atomic increment RPC for Islamic queries (same pattern as increment_research_queries)
CREATE OR REPLACE FUNCTION public.increment_islamic_queries(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.subscriptions
  SET islamic_queries_used = islamic_queries_used + 1
  WHERE user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_islamic_queries(uuid) TO authenticated;


-- ── Phase 2: scholarly_documents + pgvector (Migration 20260406000000) ──────
-- PREREQUISITE: Enable the pgvector extension in Supabase Dashboard first:
--   Dashboard → Database → Extensions → Search "vector" → Enable
-- Then run the contents of:
--   supabase/migrations/20260406000000_scholarly_documents.sql
-- (copy-paste the full file contents here, or run via supabase db push)


-- ── Phase 2: research_sessions (Migration 20260406000001) ────────────────────
-- Run the contents of:
--   supabase/migrations/20260406000001_research_sessions.sql


-- ── Phase 2: ingest_jobs (Migration 20260406000003) ──────────────────────────
-- Run the contents of:
--   supabase/migrations/20260406000003_ingest_jobs.sql


-- ── Phase 2: scholarly_documents_stats helper ─────────────────────────────
-- After ingestion, use this to monitor corpus state:
-- SELECT * FROM scholarly_documents_stats();


-- ── Phase 2: IVFFlat index (run AFTER first bulk import) ─────────────────────
-- IVFFlat requires rows to be present before index creation.
-- Run this manually after psql COPY of Tanzil + hadith-json:
--
-- CREATE INDEX scholarly_documents_embedding_idx
--   ON public.scholarly_documents
--   USING ivfflat (embedding vector_cosine_ops)
--   WITH (lists = 100);
--
-- After Shamela ingestion (~6M rows), retune: lists = 2449 (≈ sqrt(6M))
-- On Supabase Pro, upgrade to HNSW:
-- DROP INDEX scholarly_documents_embedding_idx;
-- CREATE INDEX scholarly_documents_embedding_hnsw_idx
--   ON public.scholarly_documents
--   USING hnsw (embedding vector_cosine_ops)
--   WITH (m = 16, ef_construction = 64);


-- ── Phase 4: api_response_cache + quota reset (Migration 20260407000000) ─────
-- Run the contents of:
--   supabase/migrations/20260407000000_api_response_cache.sql
-- This adds:
--   - api_response_cache table (24h TTL for Tier A API responses)
--   - purge_expired_cache() function (called by reset-monthly-quotas edge fn)
--   - reset_monthly_quotas() function (called by reset-monthly-quotas edge fn)

-- ── Phase 4: Monthly quota reset schedule ─────────────────────────────────
-- Schedule the reset-monthly-quotas edge function in Supabase Dashboard:
--   Dashboard → Edge Functions → reset-monthly-quotas → Schedule
--   Cron: 0 0 1 * *  (midnight UTC, 1st of every month)
--
-- Or invoke manually:
--   supabase functions invoke reset-monthly-quotas


-- ── VERIFY ──────────────────────────────────────────────────
SELECT
  policyname,
  tablename,
  cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('subscriptions', 'profiles')
ORDER BY tablename, policyname;

SELECT
  enumlabel AS tier_value
FROM pg_enum
  JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
WHERE pg_type.typname = 'subscription_tier'
ORDER BY enumsortorder;
