-- Add usage metering columns for OCR and Research features.
-- Free-tier defaults: 5 OCR pages / 3 research queries per billing cycle.
-- Pro-tier limits are set to high sentinel values (999) — the UI checks
-- the `tier` column and shows "Unlimited", so the hard limit is never hit
-- in practice. If you later add a true billing reset job, these are the
-- numbers it should reset `*_used` columns back to 0 against.

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS ocr_pages_used       INT4 NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ocr_pages_limit      INT4 NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS research_queries_used  INT4 NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS research_queries_limit INT4 NOT NULL DEFAULT 3;

-- Give existing Pro subscribers a high limit so enforcement never triggers.
UPDATE public.subscriptions
  SET ocr_pages_limit = 999, research_queries_limit = 999
  WHERE tier = 'pro';

COMMENT ON COLUMN public.subscriptions.ocr_pages_used        IS 'Number of images processed by OCR this cycle';
COMMENT ON COLUMN public.subscriptions.ocr_pages_limit       IS 'Maximum OCR images allowed (5 free / 999 pro)';
COMMENT ON COLUMN public.subscriptions.research_queries_used  IS 'Number of AI research queries submitted this cycle';
COMMENT ON COLUMN public.subscriptions.research_queries_limit IS 'Maximum research queries allowed (3 free / 999 pro)';
