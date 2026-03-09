ALTER TABLE public.subscriptions 
ADD COLUMN tts_characters_used integer NOT NULL DEFAULT 0,
ADD COLUMN tts_character_limit integer NOT NULL DEFAULT 2000;