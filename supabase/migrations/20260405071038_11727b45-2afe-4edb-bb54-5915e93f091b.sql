
-- 1. Add missing columns to subscriptions
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS ocr_pages_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ocr_pages_limit integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS research_queries_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS research_queries_limit integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS pending_tier text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS payment_reference text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_upgrade_request timestamp with time zone DEFAULT NULL;

-- 2. Create notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  title text NOT NULL DEFAULT '',
  message text NOT NULL DEFAULT '',
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can insert notifications"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3. Avatars bucket storage policies
CREATE POLICY "Anyone can view avatars"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

CREATE POLICY "Authenticated users can upload own avatar"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can update own avatar"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete own avatar"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- 4. Enable realtime for notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
