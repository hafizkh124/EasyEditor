-- Migration: Update tier limits
-- Basic/Pro: TTS removed (tts_character_limit = 0)
-- Ultra: STT = 54,000s (15h), TTS = 1,000,000 chars, OCR = 5,000, Research = 1,000

-- Update auto_pro_for_admin trigger to reflect new Ultra limits
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
    VALUES (NEW.user_id, 'ultra', 54000, 1000000, 5000, 1000)
    ON CONFLICT (user_id) DO UPDATE SET
      tier                  = 'ultra',
      transcription_limit   = 54000,
      tts_character_limit   = 1000000,
      ocr_pages_limit       = 5000,
      research_queries_limit = 1000;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Bring existing ultra subscribers to new limits
UPDATE public.subscriptions
SET
  transcription_limit    = 54000,
  tts_character_limit    = 1000000,
  ocr_pages_limit        = 5000,
  research_queries_limit = 1000
WHERE tier = 'ultra';

-- Strip TTS from existing basic subscribers
UPDATE public.subscriptions
SET tts_character_limit = 0
WHERE tier = 'basic';

-- Strip TTS from existing pro subscribers
UPDATE public.subscriptions
SET tts_character_limit = 0
WHERE tier = 'pro';
