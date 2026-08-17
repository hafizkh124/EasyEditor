ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS text_direction text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_text_direction_check') THEN
    ALTER TABLE public.documents ADD CONSTRAINT documents_text_direction_check CHECK (text_direction IS NULL OR text_direction IN ('rtl','ltr'));
  END IF;
END $$;