CREATE TABLE public.safepay_pending_checkouts (
  tracker_token TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  kind TEXT NOT NULL,
  tier TEXT,
  topup_key TEXT,
  tokens INTEGER,
  amount_pkr INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_at TIMESTAMPTZ
);
GRANT ALL ON public.safepay_pending_checkouts TO service_role;
ALTER TABLE public.safepay_pending_checkouts ENABLE ROW LEVEL SECURITY;