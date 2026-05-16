-- Phase B: Subscription lifecycle — activation, expiry, renewal tracking.
-- Adds activation/expiry dates so admins and users can see when a subscription
-- was activated, when it expires, and how to renew it. Backwards-compatible:
-- existing tier+limit checks keep working unchanged.

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_renewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS renewal_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS billing_cycle_days INTEGER NOT NULL DEFAULT 30;

CREATE INDEX IF NOT EXISTS idx_subscriptions_expires_at
  ON public.subscriptions(expires_at)
  WHERE expires_at IS NOT NULL;

-- One-time backfill for users already on a paid tier: estimate activation as
-- the last profile-update timestamp (when admin most recently approved them),
-- and set expiry 30 days out. Free-tier users get nothing — they have no
-- active subscription to expire.
UPDATE public.subscriptions s
SET
  activated_at = COALESCE(s.activated_at, p.updated_at, p.created_at, now()),
  expires_at = COALESCE(
    s.expires_at,
    COALESCE(p.updated_at, p.created_at, now()) + INTERVAL '30 days'
  )
FROM public.profiles p
WHERE p.user_id = s.user_id
  AND s.tier <> 'free'
  AND s.activated_at IS NULL;
