
-- Create storage bucket for voice clone samples
INSERT INTO storage.buckets (id, name, public) VALUES ('voice-clones', 'voice-clones', false);

-- RLS: Users can upload their own voice samples
CREATE POLICY "Users can upload voice clones" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'voice-clones' AND (storage.foldername(name))[1] = auth.uid()::text);

-- RLS: Users can read their own voice samples
CREATE POLICY "Users can read own voice clones" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'voice-clones' AND (storage.foldername(name))[1] = auth.uid()::text);

-- RLS: Users can delete their own voice samples
CREATE POLICY "Users can delete own voice clones" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'voice-clones' AND (storage.foldername(name))[1] = auth.uid()::text);
