
-- Add upgrade_requested column to subscriptions
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS upgrade_requested boolean NOT NULL DEFAULT false;

-- Create trigger function: auto-assign pro tier to admins
CREATE OR REPLACE FUNCTION public.auto_pro_for_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.role = 'admin' THEN
    UPDATE public.subscriptions SET tier = 'pro', transcription_limit = 999999, tts_character_limit = 999999 WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger on user_roles insert
DROP TRIGGER IF EXISTS trg_auto_pro_for_admin ON public.user_roles;
CREATE TRIGGER trg_auto_pro_for_admin
  AFTER INSERT ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_pro_for_admin();

-- Allow admins to update any subscription (for tier management)
CREATE POLICY "Admins can update all subscriptions"
  ON public.subscriptions
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Allow admins to view all subscriptions
CREATE POLICY "Admins can view all subscriptions"
  ON public.subscriptions
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
