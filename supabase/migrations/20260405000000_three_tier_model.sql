-- Three-Tier Paid Model Migration
-- Basic (1,000 PKR) / Pro (4,000 PKR) / Ultra (7,000 PKR)
-- New users start with tier='free' and ALL limits=0 until admin assigns a plan.
-- 'free' is now the "pending/unapproved" state, not a usable plan.

-- ─── 1. Add 'basic' tier to the enum ─────────────────────────────────────────
ALTER TYPE public.subscription_tier ADD VALUE IF NOT EXISTS 'basic';

-- ─── 2. Rebuild handle_new_user: all limits = 0 for new signups ──────────────
-- Existing approved users are NOT affected; this only changes trigger logic for
-- new INSERT rows on auth.users.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');

  -- All limits start at 0. Admin must approve with a plan to grant access.
  INSERT INTO public.subscriptions (
    user_id, tier,
    transcription_limit, tts_character_limit,
    ocr_pages_limit, research_queries_limit
  )
  VALUES (NEW.id, 'free', 0, 0, 0, 0);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── 3. Update auto_pro_for_admin to include ocr / research limits ────────────
CREATE OR REPLACE FUNCTION public.auto_pro_for_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.role = 'admin' THEN
    UPDATE public.subscriptions
    SET
      tier                   = 'pro',
      transcription_limit    = 999999,
      tts_character_limit    = 999999,
      ocr_pages_limit        = 999,
      research_queries_limit = 999
    WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

-- ─── Notes ────────────────────────────────────────────────────────────────────
-- • Existing users already on 'free' with real limits are unaffected.
-- • Admin approves new signups via Admin → User Management → "Select Plan" dropdown.
-- • Approving sets is_approved=true AND tier+limits atomically.
-- • Revoking sets is_approved=false AND resets tier='free' with all limits=0.
