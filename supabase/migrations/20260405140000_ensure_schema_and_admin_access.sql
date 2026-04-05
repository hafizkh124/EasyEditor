-- =============================================================
-- CATCH-UP / IDEMPOTENT MIGRATION
-- Safe to run on any DB state — all statements use IF NOT EXISTS
-- or IF EXISTS guards so re-running causes no harm.
--
-- Fixes:
--   1. Add missing subscription columns (ocr, research, tts)
--   2. Ensure 'basic' and 'ultra' enum values exist
--   3. Grant admins UPDATE access on subscriptions & profiles
--      (bypasses user-scoped RLS so admin panel can modify
--       any user's row without 400 / 403 errors)
-- =============================================================


-- ── 1. Columns ───────────────────────────────────────────────
-- These columns may be missing if earlier migrations were never applied.
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


-- ── 2. Enum values ───────────────────────────────────────────
-- PostgreSQL 15 supports ADD VALUE IF NOT EXISTS in a transaction.
ALTER TYPE public.subscription_tier ADD VALUE IF NOT EXISTS 'basic';
ALTER TYPE public.subscription_tier ADD VALUE IF NOT EXISTS 'ultra';


-- ── 3. Admin RLS policies ────────────────────────────────────
-- Allow any admin to UPDATE any subscription row.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'subscriptions'
      AND policyname = 'admins_can_update_any_subscription'
  ) THEN
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
      );
  END IF;
END
$$;

-- Allow any admin to UPDATE any profile row (is_approved, etc.).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'profiles'
      AND policyname = 'admins_can_update_any_profile'
  ) THEN
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
      );
  END IF;
END
$$;


-- ── 4. Refresh handle_new_user to include new columns ────────
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


-- ── 5. Refresh auto_pro_for_admin with new Ultra limits ──────
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
