-- Defense-in-depth: explicitly deny client-side writes on referral_events.
-- RLS already denies by default when no permissive policy exists, but
-- adding RESTRICTIVE policies guarantees no future permissive policy can
-- accidentally allow users to fabricate referral credits.

CREATE POLICY "referral_events_deny_client_insert"
  ON public.referral_events
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

CREATE POLICY "referral_events_deny_client_update"
  ON public.referral_events
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "referral_events_deny_client_delete"
  ON public.referral_events
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated, anon
  USING (false);