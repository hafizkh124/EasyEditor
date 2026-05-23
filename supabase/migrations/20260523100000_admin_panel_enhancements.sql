-- Admin Panel Enhancements: payments table, paginated user search RPC, income summary RPC

-- ============================================================
-- 1. admin_payments table — tracks fees paid by each user
-- ============================================================
CREATE TABLE public.admin_payments (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  amount_pkr        NUMERIC(10,2) NOT NULL CHECK (amount_pkr > 0),
  payment_type      TEXT NOT NULL CHECK (payment_type IN ('subscription','renewal','upgrade','topup','other')),
  payment_method    TEXT,           -- 'bank_transfer','jazzcash','easypaisa','cash'
  payment_reference TEXT,
  tier_at_payment   TEXT,
  notes             TEXT,
  recorded_by       UUID NOT NULL REFERENCES auth.users,
  payment_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at        TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.admin_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage payments"
  ON public.admin_payments
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_admin_payments_user ON public.admin_payments (user_id);
CREATE INDEX idx_admin_payments_date ON public.admin_payments (payment_date DESC);

-- ============================================================
-- 2. admin_list_users RPC — paginated search with email access
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_list_users(
  p_search     TEXT    DEFAULT '',
  p_status     TEXT    DEFAULT 'all',
  p_country    TEXT    DEFAULT '',
  p_profession TEXT    DEFAULT '',
  p_date_from  DATE    DEFAULT NULL,
  p_date_to    DATE    DEFAULT NULL,
  p_limit      INT     DEFAULT 25,
  p_offset     INT     DEFAULT 0
)
RETURNS TABLE (
  user_id           UUID,
  email             TEXT,
  display_name      TEXT,
  is_approved       BOOLEAN,
  created_at        TIMESTAMPTZ,
  tier              TEXT,
  upgrade_requested BOOLEAN,
  pending_tier      TEXT,
  payment_reference TEXT,
  last_upgrade_request TIMESTAMPTZ,
  rejection_status  TEXT,
  rejection_reason  TEXT,
  rejected_at       TIMESTAMPTZ,
  activated_at      TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,
  last_renewed_at   TIMESTAMPTZ,
  renewal_count     INT,
  billing_cycle_days INT,
  referral_code     TEXT,
  referred_by       TEXT,
  referral_credits  INT,
  whatsapp_number   TEXT,
  country           TEXT,
  profession        TEXT,
  token_monthly_balance INT,
  token_topup_balance   INT,
  token_monthly_limit   INT,
  total_count       BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_search TEXT;
BEGIN
  -- Admin guard
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  v_search := COALESCE(NULLIF(TRIM(p_search), ''), NULL);

  RETURN QUERY
  SELECT
    p.user_id,
    au.email::TEXT,
    p.display_name,
    p.is_approved,
    p.created_at,
    COALESCE(s.tier, 'free')::TEXT,
    COALESCE(s.upgrade_requested, false),
    s.pending_tier,
    s.payment_reference,
    s.last_upgrade_request,
    p.rejection_status,
    p.rejection_reason,
    p.rejected_at,
    s.activated_at,
    s.expires_at,
    s.last_renewed_at,
    COALESCE(s.renewal_count, 0)::INT,
    COALESCE(s.billing_cycle_days, 30)::INT,
    p.referral_code,
    p.referred_by,
    COALESCE(p.referral_credits, 0)::INT,
    p.whatsapp_number,
    p.country,
    p.profession,
    COALESCE(tw.monthly_balance, 0)::INT,
    COALESCE(tw.topup_balance, 0)::INT,
    COALESCE(tw.monthly_limit, 0)::INT,
    COUNT(*) OVER()
  FROM public.profiles p
  JOIN auth.users au ON au.id = p.user_id
  LEFT JOIN public.subscriptions s ON s.user_id = p.user_id
  LEFT JOIN public.token_wallets tw ON tw.user_id = p.user_id
  WHERE
    -- Status filter
    (p_status = 'all'
     OR (p_status = 'pending' AND p.is_approved = false AND (p.rejection_status IS NULL OR p.rejection_status != 'rejected'))
     OR (p_status = 'approved' AND p.is_approved = true)
     OR (p_status = 'rejected' AND p.rejection_status = 'rejected'))
    -- Search filter (ILIKE across multiple fields)
    AND (v_search IS NULL
         OR au.email ILIKE '%' || v_search || '%'
         OR p.display_name ILIKE '%' || v_search || '%'
         OR p.country ILIKE '%' || v_search || '%'
         OR p.profession ILIKE '%' || v_search || '%'
         OR p.whatsapp_number ILIKE '%' || v_search || '%')
    -- Country filter
    AND (COALESCE(NULLIF(TRIM(p_country), ''), NULL) IS NULL
         OR p.country ILIKE '%' || TRIM(p_country) || '%')
    -- Profession filter
    AND (COALESCE(NULLIF(TRIM(p_profession), ''), NULL) IS NULL
         OR p.profession = TRIM(p_profession))
    -- Date range filter (on registration date)
    AND (p_date_from IS NULL OR p.created_at::DATE >= p_date_from)
    AND (p_date_to IS NULL OR p.created_at::DATE <= p_date_to)
  ORDER BY p.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- ============================================================
-- 3. admin_get_income_summary RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_get_income_summary(
  p_date_from DATE DEFAULT NULL,
  p_date_to   DATE DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  -- Admin guard
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  SELECT json_build_object(
    'total_income', COALESCE(SUM(ap.amount_pkr), 0),
    'payment_count', COUNT(*),
    'by_type', (
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
      FROM (
        SELECT payment_type AS type, SUM(amount_pkr) AS total, COUNT(*) AS cnt
        FROM public.admin_payments
        WHERE (p_date_from IS NULL OR payment_date >= p_date_from)
          AND (p_date_to IS NULL OR payment_date <= p_date_to)
        GROUP BY payment_type
        ORDER BY total DESC
      ) t
    ),
    'by_month', (
      SELECT COALESCE(json_agg(row_to_json(m)), '[]'::json)
      FROM (
        SELECT to_char(payment_date, 'YYYY-MM') AS month, SUM(amount_pkr) AS total, COUNT(*) AS cnt
        FROM public.admin_payments
        WHERE (p_date_from IS NULL OR payment_date >= p_date_from)
          AND (p_date_to IS NULL OR payment_date <= p_date_to)
        GROUP BY to_char(payment_date, 'YYYY-MM')
        ORDER BY month DESC
      ) m
    )
  )
  INTO v_result
  FROM public.admin_payments ap
  WHERE (p_date_from IS NULL OR ap.payment_date >= p_date_from)
    AND (p_date_to IS NULL OR ap.payment_date <= p_date_to);

  RETURN v_result;
END;
$$;
