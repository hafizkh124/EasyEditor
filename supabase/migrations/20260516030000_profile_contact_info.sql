-- Profile contact info — captured on a dedicated /complete-profile onboarding
-- page after signup. WhatsApp is the team's primary follow-up channel for
-- payment and support. All three columns are nullable so existing rows are
-- unaffected; the client-side gate forces non-admin users to populate
-- whatsapp_number before they can use the app.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS whatsapp_number TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS profession TEXT;
