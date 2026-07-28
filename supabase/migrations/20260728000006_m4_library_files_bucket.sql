-- M4 fix: create the `library-files` bucket the personal corpus uploads into.
--
-- `libraryChunkService.uploadLibraryFile` writes to `library-files` and
-- `library-ingest` downloads from it, but no migration ever created the
-- bucket — so every upload failed at runtime with "Bucket not found" and
-- Pillar E could not run at all.
--
-- Object paths are `{user_id}/{item_id}.{ext}`, so the owner check is the
-- first path segment, exactly as the existing `research-files` bucket does it.

INSERT INTO storage.buckets (id, name, public)
VALUES ('library-files', 'library-files', false)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Users can upload own library files'
  ) THEN
    CREATE POLICY "Users can upload own library files"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'library-files' AND (storage.foldername(name))[1] = auth.uid()::text);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Users can read own library files'
  ) THEN
    CREATE POLICY "Users can read own library files"
      ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'library-files' AND (storage.foldername(name))[1] = auth.uid()::text);
  END IF;

  -- uploadLibraryFile passes `upsert: true`, which is an UPDATE on an
  -- existing object; without this policy re-uploading the same item fails.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Users can update own library files'
  ) THEN
    CREATE POLICY "Users can update own library files"
      ON storage.objects FOR UPDATE TO authenticated
      USING (bucket_id = 'library-files' AND (storage.foldername(name))[1] = auth.uid()::text)
      WITH CHECK (bucket_id = 'library-files' AND (storage.foldername(name))[1] = auth.uid()::text);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Users can delete own library files'
  ) THEN
    CREATE POLICY "Users can delete own library files"
      ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = 'library-files' AND (storage.foldername(name))[1] = auth.uid()::text);
  END IF;
END $$;
