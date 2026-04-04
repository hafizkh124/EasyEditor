-- Manual Payment Workflow
-- Adds 'ultra' tier, tracks pending upgrade state and payment proof.

-- 1. Extend the tier enum (ADD VALUE is irreversible — safe for forward migration)
ALTER TYPE public.subscription_tier ADD VALUE IF NOT EXISTS 'ultra';

-- 2. Add payment-workflow columns to subscriptions
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS pending_tier         TEXT          DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS payment_reference    TEXT          DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_upgrade_request TIMESTAMPTZ  DEFAULT NULL;

COMMENT ON COLUMN public.subscriptions.pending_tier          IS 'Tier the user requested to upgrade to (cleared on approval/rejection)';
COMMENT ON COLUMN public.subscriptions.payment_reference     IS 'Transaction ID / reference provided by the user as proof of payment';
COMMENT ON COLUMN public.subscriptions.last_upgrade_request  IS 'UTC timestamp of the most recent upgrade request submission';
