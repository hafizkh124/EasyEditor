
-- Create storage bucket for research files
INSERT INTO storage.buckets (id, name, public)
VALUES ('research-files', 'research-files', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: users can upload their own files
CREATE POLICY "Users can upload research files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'research-files' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Storage RLS: users can read their own files
CREATE POLICY "Users can read own research files"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'research-files' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Storage RLS: users can delete their own files
CREATE POLICY "Users can delete own research files"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'research-files' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Create research_sources table
CREATE TABLE public.research_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('url', 'pdf', 'docx')),
  title TEXT NOT NULL,
  url TEXT,
  storage_path TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.research_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sources"
ON public.research_sources FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sources"
ON public.research_sources FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own sources"
ON public.research_sources FOR DELETE
TO authenticated
USING (auth.uid() = user_id);
