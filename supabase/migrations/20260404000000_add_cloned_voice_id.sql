-- Add cloned_voice_id to profiles for cross-device voice clone persistence
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS cloned_voice_id TEXT DEFAULT NULL;

COMMENT ON COLUMN public.profiles.cloned_voice_id IS 'ElevenLabs cloned voice ID for TTS';
