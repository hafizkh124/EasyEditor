-- ============================================================================
-- Token-Based Subscription System
-- Migration: 20260522100000_token_system.sql
--
-- Adds unified token wallets, transaction audit log, top-up requests,
-- and core RPCs for the token consumption model.
--
-- Business Model:
--   Basic (1,000 PKR): 5,000 tokens/mo
--   Pro   (4,000 PKR): 25,000 tokens/mo
--   Ultra (7,000 PKR): 50,000 tokens/mo
--
-- Token Rates:
--   STT=10/min, OCR=15/page, Research=30/query, Islamic=40/query,
--   TTS_Google=50/1K chars, TTS_ElevenLabs=500/1K chars, Refine=5/action
-- ============================================================================

-- ── A. token_wallets ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.token_wallets (
  user_id         UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  monthly_balance INT  NOT NULL DEFAULT 0,   -- resets each billing cycle
  topup_balance   INT  NOT NULL DEFAULT 0,   -- persists; never expires
  monthly_limit   INT  NOT NULL DEFAULT 0,   -- allocation for the tier
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.token_wallets IS 'Per-user token balances: monthly (resets) + top-up (persistent).';
COMMENT ON COLUMN public.token_wallets.monthly_balance IS 'Remaining monthly allocation; zeroed on reset, replenished to monthly_limit.';
COMMENT ON COLUMN public.token_wallets.topup_balance   IS 'Purchased top-up tokens; never expire while account exists.';
COMMENT ON COLUMN public.token_wallets.monthly_limit    IS 'Total monthly allocation for the user''s tier (basic=5000, pro=25000, ultra=50000).';

ALTER TABLE public.token_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own wallet"
  ON public.token_wallets FOR SELECT
  USING (auth.uid() = user_id);

-- Service role can do everything; no explicit policy needed (bypasses RLS).

-- ── B. token_transactions ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.token_transactions (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  amount         INT  NOT NULL,              -- negative = debit, positive = credit
  balance_after  INT  NOT NULL,              -- total balance (monthly + topup) after this tx
  action_type    TEXT NOT NULL,              -- stt|ocr|research|islamic|tts_google|tts_elevenlabs|refine|topup|monthly_reset|bonus|admin_adjust|migration|expiry|refund
  action_detail  TEXT,                       -- human-readable detail (e.g. "3.2 min transcription")
  source         TEXT NOT NULL DEFAULT 'monthly',  -- which pool: monthly|topup|mixed
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.token_transactions IS 'Immutable audit trail of every token credit/debit.';

CREATE INDEX idx_token_tx_user_date
  ON public.token_transactions (user_id, created_at DESC);

ALTER TABLE public.token_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own transactions"
  ON public.token_transactions FOR SELECT
  USING (auth.uid() = user_id);

-- ── C. topup_requests ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.topup_requests (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  token_amount      INT  NOT NULL CHECK (token_amount >= 2500),
  pkr_amount        NUMERIC(10,2) NOT NULL,
  payment_reference TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by       UUID REFERENCES auth.users,
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.topup_requests IS 'In-app token top-up requests; admin approves after verifying payment.';

ALTER TABLE public.topup_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own topup requests"
  ON public.topup_requests FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own topup requests"
  ON public.topup_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ── D. Extend activity_log ──────────────────────────────────────────────────
ALTER TABLE public.activity_log
  ADD COLUMN IF NOT EXISTS tokens_spent INT DEFAULT 0;

-- ── E. Auto-create token wallet on subscription insert ──────────────────────
CREATE OR REPLACE FUNCTION public.create_token_wallet()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.token_wallets (user_id)
  VALUES (NEW.user_id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_token_wallet ON public.subscriptions;
CREATE TRIGGER trg_create_token_wallet
  AFTER INSERT ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.create_token_wallet();


-- ============================================================================
-- F. Core RPCs
-- ============================================================================

-- ── F1. deduct_tokens ───────────────────────────────────────────────────────
-- Atomically deducts tokens. Drains monthly_balance first, then topup_balance.
-- Returns JSON: { success, monthly_balance, topup_balance, total, error? }
CREATE OR REPLACE FUNCTION public.deduct_tokens(
  p_user_id       UUID,
  p_amount        INT,
  p_action_type   TEXT,
  p_action_detail TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_monthly   INT;
  v_topup     INT;
  v_total     INT;
  v_from_monthly INT;
  v_from_topup   INT;
  v_source    TEXT;
  v_new_monthly  INT;
  v_new_topup    INT;
  v_new_total    INT;
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;

  -- Lock the row to prevent concurrent deductions
  SELECT monthly_balance, topup_balance
    INTO v_monthly, v_topup
    FROM public.token_wallets
   WHERE user_id = p_user_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No token wallet found');
  END IF;

  v_total := v_monthly + v_topup;

  IF v_total < p_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient tokens',
      'balance', v_total,
      'required', p_amount
    );
  END IF;

  -- Drain monthly first, then topup
  IF v_monthly >= p_amount THEN
    v_from_monthly := p_amount;
    v_from_topup   := 0;
    v_source       := 'monthly';
  ELSE
    v_from_monthly := v_monthly;
    v_from_topup   := p_amount - v_monthly;
    v_source       := CASE WHEN v_from_monthly > 0 THEN 'mixed' ELSE 'topup' END;
  END IF;

  v_new_monthly := v_monthly - v_from_monthly;
  v_new_topup   := v_topup  - v_from_topup;
  v_new_total   := v_new_monthly + v_new_topup;

  UPDATE public.token_wallets
     SET monthly_balance = v_new_monthly,
         topup_balance   = v_new_topup,
         updated_at      = now()
   WHERE user_id = p_user_id;

  INSERT INTO public.token_transactions
    (user_id, amount, balance_after, action_type, action_detail, source)
  VALUES
    (p_user_id, -p_amount, v_new_total, p_action_type, p_action_detail, v_source);

  RETURN jsonb_build_object(
    'success',         true,
    'monthly_balance', v_new_monthly,
    'topup_balance',   v_new_topup,
    'total',           v_new_total
  );
END;
$$;

-- Grant to authenticated (edge functions call with service_role, but client may
-- call for future self-service flows).
GRANT EXECUTE ON FUNCTION public.deduct_tokens(UUID, INT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_tokens(UUID, INT, TEXT, TEXT) TO service_role;


-- ── F2. credit_tokens ───────────────────────────────────────────────────────
-- Adds tokens to the specified pool (monthly or topup).
CREATE OR REPLACE FUNCTION public.credit_tokens(
  p_user_id       UUID,
  p_amount        INT,
  p_source        TEXT,         -- 'monthly' or 'topup'
  p_action_type   TEXT,
  p_detail        TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_monthly INT;
  v_new_topup   INT;
  v_new_total   INT;
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;

  IF p_source = 'monthly' THEN
    UPDATE public.token_wallets
       SET monthly_balance = monthly_balance + p_amount,
           updated_at      = now()
     WHERE user_id = p_user_id
     RETURNING monthly_balance, topup_balance
       INTO v_new_monthly, v_new_topup;
  ELSIF p_source = 'topup' THEN
    UPDATE public.token_wallets
       SET topup_balance = topup_balance + p_amount,
           updated_at    = now()
     WHERE user_id = p_user_id
     RETURNING monthly_balance, topup_balance
       INTO v_new_monthly, v_new_topup;
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Invalid source; must be monthly or topup');
  END IF;

  IF v_new_monthly IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No token wallet found');
  END IF;

  v_new_total := v_new_monthly + v_new_topup;

  INSERT INTO public.token_transactions
    (user_id, amount, balance_after, action_type, action_detail, source)
  VALUES
    (p_user_id, p_amount, v_new_total, p_action_type, p_detail, p_source);

  RETURN jsonb_build_object(
    'success',         true,
    'monthly_balance', v_new_monthly,
    'topup_balance',   v_new_topup,
    'total',           v_new_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.credit_tokens(UUID, INT, TEXT, TEXT, TEXT) TO service_role;


-- ── F3. check_token_balance ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_token_balance(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_monthly INT;
  v_topup   INT;
  v_limit   INT;
BEGIN
  SELECT monthly_balance, topup_balance, monthly_limit
    INTO v_monthly, v_topup, v_limit
    FROM public.token_wallets
   WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'monthly_balance', 0, 'topup_balance', 0,
      'monthly_limit', 0, 'total', 0
    );
  END IF;

  RETURN jsonb_build_object(
    'monthly_balance', v_monthly,
    'topup_balance',   v_topup,
    'monthly_limit',   v_limit,
    'total',           v_monthly + v_topup
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_token_balance(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_token_balance(UUID) TO service_role;


-- ── F4. reset_monthly_tokens ────────────────────────────────────────────────
-- Called by the monthly cron job. Calculates bonus from unused monthly tokens,
-- adds bonus to topup pool, then resets monthly_balance to monthly_limit.
-- Also resets the legacy *_used columns for backward compatibility.
CREATE OR REPLACE FUNCTION public.reset_monthly_tokens(
  p_bonus_rate NUMERIC DEFAULT 0.15
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row       RECORD;
  v_bonus     INT;
  v_new_total INT;
  v_count     INT := 0;
BEGIN
  FOR v_row IN
    SELECT tw.user_id, tw.monthly_balance, tw.topup_balance, tw.monthly_limit
      FROM public.token_wallets tw
      JOIN public.subscriptions s ON s.user_id = tw.user_id
     WHERE s.tier != 'free'
       AND tw.monthly_limit > 0
       AND (s.expires_at IS NULL OR s.expires_at > now())
  LOOP
    -- Calculate bonus from unused monthly tokens
    v_bonus := FLOOR(v_row.monthly_balance * p_bonus_rate);

    -- Credit bonus to topup (if any)
    IF v_bonus > 0 THEN
      UPDATE public.token_wallets
         SET topup_balance = topup_balance + v_bonus,
             updated_at    = now()
       WHERE user_id = v_row.user_id;

      v_new_total := v_row.monthly_limit + v_row.topup_balance + v_bonus;

      INSERT INTO public.token_transactions
        (user_id, amount, balance_after, action_type, action_detail, source)
      VALUES
        (v_row.user_id, v_bonus, v_new_total,
         'bonus',
         format('15%% bonus on %s unused monthly tokens', v_row.monthly_balance),
         'topup');
    ELSE
      v_new_total := v_row.monthly_limit + v_row.topup_balance;
    END IF;

    -- Reset monthly_balance to full allocation
    UPDATE public.token_wallets
       SET monthly_balance = monthly_limit,
           updated_at      = now()
     WHERE user_id = v_row.user_id;

    INSERT INTO public.token_transactions
      (user_id, amount, balance_after, action_type, action_detail, source)
    VALUES
      (v_row.user_id, v_row.monthly_limit, v_new_total,
       'monthly_reset',
       format('Monthly reset: %s tokens allocated', v_row.monthly_limit),
       'monthly');

    v_count := v_count + 1;
  END LOOP;

  -- Also reset legacy *_used columns (backward compat for analytics dashboards)
  UPDATE public.subscriptions
     SET transcription_seconds_used = 0,
         tts_characters_used        = 0,
         ocr_pages_used             = 0,
         research_queries_used      = 0,
         islamic_queries_used       = 0
   WHERE tier != 'free';

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_monthly_tokens(NUMERIC) TO service_role;


-- ============================================================================
-- G. Backfill existing users
-- ============================================================================
-- Insert a token_wallets row for every existing user based on their current tier.
INSERT INTO public.token_wallets (user_id, monthly_balance, topup_balance, monthly_limit)
SELECT
  s.user_id,
  CASE s.tier
    WHEN 'basic' THEN 5000
    WHEN 'pro'   THEN 25000
    WHEN 'ultra'  THEN 50000
    ELSE 0
  END AS monthly_balance,
  0 AS topup_balance,
  CASE s.tier
    WHEN 'basic' THEN 5000
    WHEN 'pro'   THEN 25000
    WHEN 'ultra'  THEN 50000
    ELSE 0
  END AS monthly_limit
FROM public.subscriptions s
ON CONFLICT (user_id) DO NOTHING;

-- Log migration transactions for audit trail
INSERT INTO public.token_transactions
  (user_id, amount, balance_after, action_type, action_detail, source)
SELECT
  tw.user_id,
  tw.monthly_balance,
  tw.monthly_balance,
  'migration',
  format('Initial token allocation for %s tier', s.tier),
  'monthly'
FROM public.token_wallets tw
JOIN public.subscriptions s ON s.user_id = tw.user_id
WHERE tw.monthly_balance > 0;
