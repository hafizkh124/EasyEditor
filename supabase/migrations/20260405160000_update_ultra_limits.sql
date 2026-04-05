-- Update Ultra tier limits to final planned values
-- stt: 36,000s (10 hours) | tts: 500,000 chars | ocr: 2,000 pages | research: 500 queries

UPDATE public.subscriptions
SET
  transcription_limit    = 36000,
  tts_character_limit    = 500000,
  ocr_pages_limit        = 2000,
  research_queries_limit = 500
WHERE tier = 'ultra';

-- Rebuild auto_pro_for_admin to match
CREATE OR REPLACE FUNCTION public.auto_pro_for_admin()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = NEW.user_id AND role = 'admin'
  ) THEN
    INSERT INTO public.subscriptions (
      user_id, tier,
      transcription_limit, tts_character_limit,
      ocr_pages_limit, research_queries_limit
    )
    VALUES (NEW.user_id, 'ultra', 36000, 500000, 2000, 500)
    ON CONFLICT (user_id) DO UPDATE SET
      tier                   = 'ultra',
      transcription_limit    = 36000,
      tts_character_limit    = 500000,
      ocr_pages_limit        = 2000,
      research_queries_limit = 500;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
