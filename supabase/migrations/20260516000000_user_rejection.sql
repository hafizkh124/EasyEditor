-- Phase A.3: Admin can reject pending registrations with optional reason.
-- A user's state is now one of:
--   approved  → is_approved = true
--   rejected  → is_approved = false AND rejection_status = 'rejected'
--   pending   → is_approved = false AND rejection_status IS NULL
-- Keeping is_approved as the primary gate preserves backwards compatibility
-- with all existing checks (`is_approved === true`).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS rejection_status TEXT
    CHECK (rejection_status IS NULL OR rejection_status = 'rejected')
    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_rejection_status
  ON public.profiles(rejection_status)
  WHERE rejection_status IS NOT NULL;
