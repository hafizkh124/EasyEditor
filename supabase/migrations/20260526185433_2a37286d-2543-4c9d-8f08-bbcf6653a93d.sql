ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS paddle_subscription_id text,
  ADD COLUMN IF NOT EXISTS paddle_customer_id text,
  ADD COLUMN IF NOT EXISTS environment text,
  ADD COLUMN IF NOT EXISTS payment_source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_paddle_subscription_id_key
  ON public.subscriptions(paddle_subscription_id)
  WHERE paddle_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_paddle_customer
  ON public.subscriptions(paddle_customer_id)
  WHERE paddle_customer_id IS NOT NULL;