
-- 1. Subscriptions: replace permissive user UPDATE with locked-down WITH CHECK
DROP POLICY IF EXISTS "Users can update their own subscription" ON public.subscriptions;

CREATE POLICY "Users can request subscription upgrades"
  ON public.subscriptions
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND tier                       = (SELECT tier FROM public.subscriptions WHERE user_id = auth.uid())
    AND transcription_limit        = (SELECT transcription_limit FROM public.subscriptions WHERE user_id = auth.uid())
    AND tts_character_limit        = (SELECT tts_character_limit FROM public.subscriptions WHERE user_id = auth.uid())
    AND ocr_pages_limit            = (SELECT ocr_pages_limit FROM public.subscriptions WHERE user_id = auth.uid())
    AND research_queries_limit     = (SELECT research_queries_limit FROM public.subscriptions WHERE user_id = auth.uid())
    AND islamic_queries_limit      = (SELECT islamic_queries_limit FROM public.subscriptions WHERE user_id = auth.uid())
    AND transcription_seconds_used = (SELECT transcription_seconds_used FROM public.subscriptions WHERE user_id = auth.uid())
    AND tts_characters_used        = (SELECT tts_characters_used FROM public.subscriptions WHERE user_id = auth.uid())
    AND ocr_pages_used             = (SELECT ocr_pages_used FROM public.subscriptions WHERE user_id = auth.uid())
    AND research_queries_used      = (SELECT research_queries_used FROM public.subscriptions WHERE user_id = auth.uid())
    AND islamic_queries_used       = (SELECT islamic_queries_used FROM public.subscriptions WHERE user_id = auth.uid())
    AND activated_at               IS NOT DISTINCT FROM (SELECT activated_at FROM public.subscriptions WHERE user_id = auth.uid())
    AND expires_at                 IS NOT DISTINCT FROM (SELECT expires_at FROM public.subscriptions WHERE user_id = auth.uid())
    AND last_renewed_at            IS NOT DISTINCT FROM (SELECT last_renewed_at FROM public.subscriptions WHERE user_id = auth.uid())
    AND renewal_count              = (SELECT renewal_count FROM public.subscriptions WHERE user_id = auth.uid())
    AND billing_cycle_days         = (SELECT billing_cycle_days FROM public.subscriptions WHERE user_id = auth.uid())
  );

-- 2. ingest_jobs: restrict to admins
DROP POLICY IF EXISTS "ingest_jobs_authenticated_read" ON public.ingest_jobs;

CREATE POLICY "ingest_jobs_admin_read"
  ON public.ingest_jobs
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3. voice-clones storage: add owner-scoped UPDATE policy
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'voice_clones_owner_update'
  ) THEN
    CREATE POLICY "voice_clones_owner_update"
      ON storage.objects
      FOR UPDATE
      TO authenticated
      USING (bucket_id = 'voice-clones' AND (storage.foldername(name))[1] = auth.uid()::text)
      WITH CHECK (bucket_id = 'voice-clones' AND (storage.foldername(name))[1] = auth.uid()::text);
  END IF;
END $$;
