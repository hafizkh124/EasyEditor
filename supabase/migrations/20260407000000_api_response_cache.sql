-- ================================================================
-- Migration: api_response_cache — 24h TTL cache for Tier A API results
-- Reduces repeat latency for identical Islamic research queries.
-- Cache key: SHA256(domain + ':' + normalized_arabic(query))
-- ================================================================

CREATE TABLE IF NOT EXISTS public.api_response_cache (
  cache_key  TEXT        PRIMARY KEY,   -- SHA256 hex of domain+normalizedQuery
  domain     TEXT        NOT NULL,      -- 'dorar' | 'alquran' | 'sunnah' | 'quran-com'
  response   JSONB       NOT NULL,      -- serialized IslamicResult[]
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL       -- typically created_at + 24 hours
);

-- Index for efficient TTL cleanup (run periodically via pgcron or maintenance fn)
CREATE INDEX IF NOT EXISTS api_response_cache_expires_idx
  ON public.api_response_cache (expires_at);

-- Index for domain-level monitoring
CREATE INDEX IF NOT EXISTS api_response_cache_domain_idx
  ON public.api_response_cache (domain);

-- RLS: only service_role reads/writes (called from edge functions via service key)
ALTER TABLE public.api_response_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "api_response_cache_service_role"
  ON public.api_response_cache
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Admins can view cache stats
CREATE POLICY "api_response_cache_authenticated_read"
  ON public.api_response_cache
  FOR SELECT TO authenticated
  USING (true);

-- ── Cache cleanup function ────────────────────────────────────────────────────
-- Call this periodically (pg_cron or Supabase Dashboard scheduled function)
-- to purge expired cache entries and keep the table lean.
CREATE OR REPLACE FUNCTION public.purge_expired_cache()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INT;
BEGIN
  DELETE FROM public.api_response_cache WHERE expires_at < now();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.purge_expired_cache() TO service_role;

-- ── Monthly quota reset function ──────────────────────────────────────────────
-- Resets all usage counters to 0 on the 1st of each month.
-- Scheduled via reset-monthly-quotas edge function (cron: 0 0 1 * *).
CREATE OR REPLACE FUNCTION public.reset_monthly_quotas()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count INT;
BEGIN
  UPDATE public.subscriptions
  SET
    transcription_seconds_used = 0,
    tts_characters_used        = 0,
    ocr_pages_used             = 0,
    research_queries_used      = 0,
    islamic_queries_used       = 0
  WHERE tier != 'free';  -- only reset paying users
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_monthly_quotas() TO service_role;
