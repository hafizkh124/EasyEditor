
-- 1. Defense-in-depth RESTRICTIVE policy on profiles: prevent non-admins from
--    changing admin-managed columns even if the trigger were disabled.
DROP POLICY IF EXISTS "profiles_restrict_admin_fields_self_update" ON public.profiles;
CREATE POLICY "profiles_restrict_admin_fields_self_update"
ON public.profiles
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR auth.uid() = user_id
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR (
    auth.uid() = user_id
    AND is_approved      = (SELECT p.is_approved      FROM public.profiles p WHERE p.user_id = auth.uid())
    AND rejection_status IS NOT DISTINCT FROM (SELECT p.rejection_status FROM public.profiles p WHERE p.user_id = auth.uid())
    AND rejection_reason IS NOT DISTINCT FROM (SELECT p.rejection_reason FROM public.profiles p WHERE p.user_id = auth.uid())
    AND rejected_at      IS NOT DISTINCT FROM (SELECT p.rejected_at      FROM public.profiles p WHERE p.user_id = auth.uid())
    AND rejected_by      IS NOT DISTINCT FROM (SELECT p.rejected_by      FROM public.profiles p WHERE p.user_id = auth.uid())
    AND referral_credits = (SELECT p.referral_credits FROM public.profiles p WHERE p.user_id = auth.uid())
    AND referral_code    IS NOT DISTINCT FROM (SELECT p.referral_code    FROM public.profiles p WHERE p.user_id = auth.uid())
    AND referred_by      IS NOT DISTINCT FROM (SELECT p.referred_by      FROM public.profiles p WHERE p.user_id = auth.uid())
    AND cloned_voice_id  IS NOT DISTINCT FROM (SELECT p.cloned_voice_id  FROM public.profiles p WHERE p.user_id = auth.uid())
  )
);

-- 2. Admin access to topup_requests so the approval workflow has an explicit RLS path.
DROP POLICY IF EXISTS "Admins can view topup requests" ON public.topup_requests;
CREATE POLICY "Admins can view topup requests"
ON public.topup_requests
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can update topup requests" ON public.topup_requests;
CREATE POLICY "Admins can update topup requests"
ON public.topup_requests
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));
