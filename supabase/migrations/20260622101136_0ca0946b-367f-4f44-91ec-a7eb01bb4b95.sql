
-- 1. New columns on subscriptions for AI verification
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS payment_proof_url TEXT,
  ADD COLUMN IF NOT EXISTS ai_verification_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS ai_confidence_score INTEGER,
  ADD COLUMN IF NOT EXISTS ai_verification_details JSONB;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'subscriptions_ai_verification_status_check'
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_ai_verification_status_check
      CHECK (ai_verification_status IN ('none','auto_approved','manual_review','rejected'));
  END IF;
END $$;

-- 2. Update self-escalation trigger to also protect AI verification fields
CREATE OR REPLACE FUNCTION public.prevent_subscription_self_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
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
     OR NEW.payment_proof_url        IS DISTINCT FROM OLD.payment_proof_url
     OR NEW.ai_verification_status   IS DISTINCT FROM OLD.ai_verification_status
     OR NEW.ai_confidence_score      IS DISTINCT FROM OLD.ai_confidence_score
     OR NEW.ai_verification_details  IS DISTINCT FROM OLD.ai_verification_details
  THEN
    RAISE EXCEPTION 'Not allowed: only admins may modify subscription tier, limits, usage, billing, or AI verification fields';
  END IF;

  RETURN NEW;
END;
$function$;

-- 3. Drop & recreate admin_list_users RPC with new return columns
DROP FUNCTION IF EXISTS public.admin_list_users(text,text,text,text,date,date,integer,integer);

CREATE FUNCTION public.admin_list_users(
  p_search text DEFAULT ''::text,
  p_status text DEFAULT 'all'::text,
  p_country text DEFAULT ''::text,
  p_profession text DEFAULT ''::text,
  p_date_from date DEFAULT NULL::date,
  p_date_to date DEFAULT NULL::date,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
 RETURNS TABLE(
  user_id uuid, email text, display_name text, is_approved boolean,
  created_at timestamp with time zone, tier text, upgrade_requested boolean,
  pending_tier text, payment_reference text, last_upgrade_request timestamp with time zone,
  rejection_status text, rejection_reason text, rejected_at timestamp with time zone,
  activated_at timestamp with time zone, expires_at timestamp with time zone,
  last_renewed_at timestamp with time zone, renewal_count integer, billing_cycle_days integer,
  referral_code text, referred_by text, referral_credits integer,
  whatsapp_number text, country text, profession text,
  token_monthly_balance integer, token_topup_balance integer, token_monthly_limit integer,
  payment_proof_url text, ai_verification_status text, ai_confidence_score integer,
  ai_verification_details jsonb,
  total_count bigint
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_search TEXT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;
  v_search := COALESCE(NULLIF(TRIM(p_search), ''), NULL);
  RETURN QUERY
  SELECT
    p.user_id,
    au.email::TEXT,
    p.display_name::TEXT,
    p.is_approved,
    p.created_at,
    COALESCE(s.tier::TEXT, 'free')::TEXT,
    COALESCE(s.upgrade_requested, false),
    s.pending_tier::TEXT,
    s.payment_reference::TEXT,
    s.last_upgrade_request,
    p.rejection_status::TEXT,
    p.rejection_reason::TEXT,
    p.rejected_at,
    s.activated_at,
    s.expires_at,
    s.last_renewed_at,
    COALESCE(s.renewal_count, 0)::INTEGER,
    COALESCE(s.billing_cycle_days, 30)::INTEGER,
    p.referral_code::TEXT,
    p.referred_by::TEXT,
    COALESCE(p.referral_credits, 0)::INTEGER,
    p.whatsapp_number::TEXT,
    p.country::TEXT,
    p.profession::TEXT,
    COALESCE(tw.monthly_balance, 0)::INTEGER,
    COALESCE(tw.topup_balance, 0)::INTEGER,
    COALESCE(tw.monthly_limit, 0)::INTEGER,
    s.payment_proof_url::TEXT,
    COALESCE(s.ai_verification_status, 'none')::TEXT,
    s.ai_confidence_score,
    s.ai_verification_details,
    COUNT(*) OVER()::BIGINT
  FROM public.profiles p
  JOIN auth.users au ON au.id = p.user_id
  LEFT JOIN public.subscriptions s ON s.user_id = p.user_id
  LEFT JOIN public.token_wallets tw ON tw.user_id = p.user_id
  WHERE
    (p_status = 'all'
     OR (p_status = 'pending' AND p.is_approved = false AND (p.rejection_status IS NULL OR p.rejection_status != 'rejected'))
     OR (p_status = 'approved' AND p.is_approved = true)
     OR (p_status = 'rejected' AND p.rejection_status = 'rejected'))
    AND (v_search IS NULL
         OR au.email ILIKE '%' || v_search || '%'
         OR p.display_name ILIKE '%' || v_search || '%'
         OR p.country ILIKE '%' || v_search || '%'
         OR p.profession ILIKE '%' || v_search || '%'
         OR p.whatsapp_number ILIKE '%' || v_search || '%')
    AND (COALESCE(NULLIF(TRIM(p_country), ''), NULL) IS NULL
         OR p.country ILIKE '%' || TRIM(p_country) || '%')
    AND (COALESCE(NULLIF(TRIM(p_profession), ''), NULL) IS NULL
         OR p.profession = TRIM(p_profession))
    AND (p_date_from IS NULL OR p.created_at::DATE >= p_date_from)
    AND (p_date_to IS NULL OR p.created_at::DATE <= p_date_to)
  ORDER BY p.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;

-- 4. Drop unused SafePay table
DROP TABLE IF EXISTS public.safepay_pending_checkouts;

-- 5. Storage RLS policies for payment-receipts bucket
DROP POLICY IF EXISTS "Users can upload their own receipts" ON storage.objects;
CREATE POLICY "Users can upload their own receipts"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'payment-receipts'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Users can read their own receipts" ON storage.objects;
CREATE POLICY "Users can read their own receipts"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'payment-receipts'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Admins can read all receipts" ON storage.objects;
CREATE POLICY "Admins can read all receipts"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'payment-receipts'
  AND public.has_role(auth.uid(), 'admin')
);
