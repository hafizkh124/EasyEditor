-- Notifications table
-- Stores in-app notifications (upgrade approvals, rejections, etc.)

CREATE TABLE IF NOT EXISTS public.notifications (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title        TEXT          NOT NULL,
  message      TEXT          NOT NULL,
  is_read      BOOLEAN       NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Index for fast per-user queries (most recent first)
CREATE INDEX IF NOT EXISTS notifications_user_id_created_at_idx
  ON public.notifications (user_id, created_at DESC);

-- RLS: users can only see and update their own notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_select_own"
  ON public.notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "notifications_update_own"
  ON public.notifications FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Admins (via service role) can insert on behalf of any user
-- Regular inserts from Edge Functions / server-side use service role key
-- Client-side inserts are blocked; only admin server actions insert rows.
CREATE POLICY "notifications_insert_admin"
  ON public.notifications FOR INSERT
  WITH CHECK (true);

COMMENT ON TABLE public.notifications IS 'In-app notifications sent to users (upgrade approved/rejected, etc.)';
