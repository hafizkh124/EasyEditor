-- Add Islamic research query tracking columns to subscriptions
-- These are separate from the general research_queries_* columns
-- Islamic mode uses authenticated scholarly sources (Dorar, AlQuran, Sunnah, etc.)

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS islamic_queries_used  INT4 NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS islamic_queries_limit INT4 NOT NULL DEFAULT 0;

-- Set default limits per tier for existing rows
UPDATE public.subscriptions SET islamic_queries_limit = 10  WHERE tier = 'basic';
UPDATE public.subscriptions SET islamic_queries_limit = 100 WHERE tier = 'pro';
UPDATE public.subscriptions SET islamic_queries_limit = 500 WHERE tier = 'ultra';

-- Atomic increment RPC for Islamic queries (same pattern as research_queries)
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
