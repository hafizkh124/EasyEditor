
-- Prevent users from self-modifying admin-controlled profile fields.
CREATE OR REPLACE FUNCTION public.prevent_profile_admin_field_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.is_approved       IS DISTINCT FROM OLD.is_approved
     OR NEW.rejected_by    IS DISTINCT FROM OLD.rejected_by
     OR NEW.rejected_at    IS DISTINCT FROM OLD.rejected_at
     OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason
     OR NEW.rejection_status IS DISTINCT FROM OLD.rejection_status
     OR NEW.referral_credits IS DISTINCT FROM OLD.referral_credits
     OR NEW.referral_code    IS DISTINCT FROM OLD.referral_code
     OR NEW.referred_by      IS DISTINCT FROM OLD.referred_by
     OR NEW.cloned_voice_id  IS DISTINCT FROM OLD.cloned_voice_id
     OR NEW.user_id          IS DISTINCT FROM OLD.user_id
  THEN
    RAISE EXCEPTION 'Not allowed: only admins may modify approval, rejection, referral, or voice-clone fields';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_profile_admin_field_self_update_trg ON public.profiles;
CREATE TRIGGER prevent_profile_admin_field_self_update_trg
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_admin_field_self_update();
