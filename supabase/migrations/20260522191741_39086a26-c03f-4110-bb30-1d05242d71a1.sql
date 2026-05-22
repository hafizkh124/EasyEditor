
-- 1. Drop overly-permissive avatars upload policy (path-scoped one remains)
DROP POLICY IF EXISTS "Allow authenticated uploads" ON storage.objects;

-- 2. Prevent users from escalating their subscription via direct UPDATE.
--    Trigger blocks non-admins from modifying protected columns.
CREATE OR REPLACE FUNCTION public.prevent_subscription_self_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Admins and service-role bypass
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.tier                    IS DISTINCT FROM OLD.tier
     OR NEW.transcription_limit  IS DISTINCT FROM OLD.transcription_limit
     OR NEW.tts_character_limit  IS DISTINCT FROM OLD.tts_character_limit
     OR NEW.ocr_pages_limit      IS DISTINCT FROM OLD.ocr_pages_limit
     OR NEW.research_queries_limit IS DISTINCT FROM OLD.research_queries_limit
     OR NEW.transcription_seconds_used IS DISTINCT FROM OLD.transcription_seconds_used
     OR NEW.tts_characters_used  IS DISTINCT FROM OLD.tts_characters_used
     OR NEW.ocr_pages_used       IS DISTINCT FROM OLD.ocr_pages_used
     OR NEW.research_queries_used IS DISTINCT FROM OLD.research_queries_used
     OR NEW.islamic_queries_used IS DISTINCT FROM OLD.islamic_queries_used
     OR NEW.activated_at         IS DISTINCT FROM OLD.activated_at
     OR NEW.expires_at           IS DISTINCT FROM OLD.expires_at
     OR NEW.last_renewed_at      IS DISTINCT FROM OLD.last_renewed_at
     OR NEW.renewal_count        IS DISTINCT FROM OLD.renewal_count
     OR NEW.billing_cycle_days   IS DISTINCT FROM OLD.billing_cycle_days
     OR NEW.is_approved          IS DISTINCT FROM OLD.is_approved
  THEN
    RAISE EXCEPTION 'Not allowed: only admins may modify subscription tier, limits, usage, or billing fields';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_subscription_self_escalation_trg ON public.subscriptions;
CREATE TRIGGER prevent_subscription_self_escalation_trg
BEFORE UPDATE ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.prevent_subscription_self_escalation();

-- 3. Realtime channel authorization: restrict subscriptions to user-owned topics.
--    Convention: per-user topics must include the user's uid (e.g. "notifications:<uid>").
ALTER TABLE IF EXISTS realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can only subscribe to their own topics" ON realtime.messages;
CREATE POLICY "Users can only subscribe to their own topics"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND realtime.topic() LIKE '%' || auth.uid()::text || '%'
);

DROP POLICY IF EXISTS "Users can only broadcast to their own topics" ON realtime.messages;
CREATE POLICY "Users can only broadcast to their own topics"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND realtime.topic() LIKE '%' || auth.uid()::text || '%'
);

-- 4. Lock down token wallet admin RPCs — only service-role (edge functions) may call.
REVOKE EXECUTE ON FUNCTION public.deduct_tokens(uuid, integer, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.credit_tokens(uuid, integer, text, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reset_monthly_tokens(numeric) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reset_monthly_quotas() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_research_queries(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_islamic_queries(uuid) FROM anon, authenticated;
-- check_token_balance stays callable by signed-in users (reads own balance only).
