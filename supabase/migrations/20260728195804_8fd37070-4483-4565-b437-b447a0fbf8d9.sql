-- ===== 20260728000000_workspace_core.sql =====
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'general' CHECK (kind IN ('research', 'book', 'translation', 'general')),
  status TEXT NOT NULL DEFAULT 'active',
  genre TEXT,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled Document',
  doc_type TEXT NOT NULL DEFAULT 'prose',
  content_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  plain_text TEXT NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'final', 'archived')),
  word_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  content_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  plain_text TEXT NOT NULL DEFAULT '',
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.library_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('book', 'pdf', 'audio', 'ocr', 'reference', 'note')),
  title TEXT NOT NULL,
  source_ref JSONB DEFAULT '{}'::jsonb,
  storage_path TEXT,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  anchor JSONB NOT NULL DEFAULT '{}'::jsonb,
  note TEXT NOT NULL,
  color TEXT DEFAULT 'yellow',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.task_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  task_slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  input JSONB DEFAULT '{}'::jsonb,
  output JSONB DEFAULT '{}'::jsonb,
  sources JSONB DEFAULT '[]'::jsonb,
  confidence NUMERIC(4,3),
  model TEXT,
  tokens_spent INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_project_sort ON public.documents(project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_documents_user_updated ON public.documents(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_versions_doc_created ON public.document_versions(document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_library_items_user ON public.library_items(user_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_user_created ON public.task_runs(user_id, created_at DESC);

ALTER TABLE IF EXISTS public.book_projects
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.translation_projects
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.book_sections
  ADD COLUMN IF NOT EXISTS document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_book_sections_document ON public.book_sections(document_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.library_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.annotations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_runs TO authenticated;
GRANT ALL ON public.projects TO service_role;
GRANT ALL ON public.documents TO service_role;
GRANT ALL ON public.document_versions TO service_role;
GRANT ALL ON public.library_items TO service_role;
GRANT ALL ON public.annotations TO service_role;
GRANT ALL ON public.task_runs TO service_role;

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own projects" ON public.projects;
CREATE POLICY "Users manage their own projects"
  ON public.projects FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage their own documents" ON public.documents;
CREATE POLICY "Users manage their own documents"
  ON public.documents FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users access versions of their documents" ON public.document_versions;
CREATE POLICY "Users access versions of their documents"
  ON public.document_versions FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.documents d WHERE d.id = document_versions.document_id AND d.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Users manage their own library items" ON public.library_items;
CREATE POLICY "Users manage their own library items"
  ON public.library_items FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage annotations on their documents" ON public.annotations;
CREATE POLICY "Users manage annotations on their documents"
  ON public.annotations FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users access their task runs" ON public.task_runs;
CREATE POLICY "Users access their task runs"
  ON public.task_runs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_projects_updated_at ON public.projects;
CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS update_documents_updated_at ON public.documents;
CREATE TRIGGER update_documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ===== 20260728000001_m3_tasks.sql =====
ALTER TABLE public.task_runs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.task_runs ADD COLUMN IF NOT EXISTS progress JSONB DEFAULT '{"total":0, "done":0, "failed":0, "skipped":0}'::jsonb;
ALTER TABLE public.task_runs ADD COLUMN IF NOT EXISTS error TEXT;

ALTER TABLE public.task_runs DROP CONSTRAINT IF EXISTS task_runs_status_check;
ALTER TABLE public.task_runs ADD CONSTRAINT task_runs_status_check CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled'));
ALTER TABLE public.task_runs ALTER COLUMN status SET DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_task_runs_doc_created ON public.task_runs(document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_runs_unfinished ON public.task_runs(user_id, created_at DESC) WHERE status IN ('pending', 'running');

CREATE TABLE IF NOT EXISTS public.ai_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  label TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  base_task_slug TEXT,
  scope TEXT NOT NULL DEFAULT 'either' CHECK (scope IN ('selection', 'document', 'either')),
  apply_mode TEXT NOT NULL DEFAULT 'inline' CHECK (apply_mode IN ('inline', 'block', 'append', 'replace_document')),
  output_format TEXT NOT NULL DEFAULT 'text' CHECK (output_format IN ('text', 'html')),
  chunkable BOOLEAN NOT NULL DEFAULT true,
  produces_sources BOOLEAN NOT NULL DEFAULT false,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_tasks_user_slug_unique UNIQUE (user_id, slug)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_tasks TO authenticated;
GRANT ALL ON public.ai_tasks TO service_role;

ALTER TABLE public.ai_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users access own tasks" ON public.ai_tasks;
CREATE POLICY "Users access own tasks" ON public.ai_tasks
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_task_runs_modtime ON public.task_runs;
CREATE TRIGGER update_task_runs_modtime
  BEFORE UPDATE ON public.task_runs
  FOR EACH ROW EXECUTE PROCEDURE handle_updated_at();

DROP TRIGGER IF EXISTS update_ai_tasks_modtime ON public.ai_tasks;
CREATE TRIGGER update_ai_tasks_modtime
  BEFORE UPDATE ON public.ai_tasks
  FOR EACH ROW EXECUTE PROCEDURE handle_updated_at();

-- ===== 20260728000002_m4_personal_corpus.sql =====
CREATE TABLE IF NOT EXISTS public.library_chunks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  library_item_id UUID NOT NULL REFERENCES public.library_items(id) ON DELETE CASCADE,
  chunk_index     INT  NOT NULL,
  content         TEXT NOT NULL,
  language        TEXT NOT NULL DEFAULT 'ur',
  char_start      INT,
  char_end        INT,
  embedding       VECTOR(768),
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (library_item_id, chunk_index)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.library_chunks TO authenticated;
GRANT ALL ON public.library_chunks TO service_role;

ALTER TABLE public.library_chunks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'library_chunks' AND policyname = 'Users access own chunks'
  ) THEN
    CREATE POLICY "Users access own chunks" ON public.library_chunks
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_library_chunks_item ON public.library_chunks(library_item_id, chunk_index);

CREATE OR REPLACE FUNCTION public.match_library_chunks(
  query_embedding VECTOR(768),
  match_threshold FLOAT DEFAULT 0.6,
  match_count     INT   DEFAULT 8,
  filter_item_ids UUID[] DEFAULT NULL
) RETURNS TABLE (
  id UUID,
  library_item_id UUID,
  chunk_index INT,
  content TEXT,
  language TEXT,
  meta JSONB,
  similarity FLOAT
) LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT id, library_item_id, chunk_index, content, language, meta,
         1 - (embedding <=> query_embedding) AS similarity
  FROM public.library_chunks
  WHERE embedding IS NOT NULL
    AND (filter_item_ids IS NULL OR library_item_id = ANY(filter_item_ids))
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_library_chunks(VECTOR(768), FLOAT, INT, UUID[]) TO authenticated;

-- ===== 20260728000003_m4_knowledge_graph.sql =====
CREATE TABLE IF NOT EXISTS public.entities (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  canonical_name TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('person', 'concept', 'book', 'location', 'event')),
  aliases        TEXT[] DEFAULT '{}',
  summary        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, canonical_name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.entities TO authenticated;
GRANT ALL ON public.entities TO service_role;

ALTER TABLE public.entities ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'entities' AND policyname = 'Users access own entities'
  ) THEN
    CREATE POLICY "Users access own entities" ON public.entities
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_entities_user_kind ON public.entities(user_id, kind);
CREATE INDEX IF NOT EXISTS idx_entities_canonical ON public.entities(canonical_name);

CREATE TABLE IF NOT EXISTS public.entity_relations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_entity_id UUID NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  target_entity_id UUID NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  relation_type    TEXT NOT NULL,
  evidence_quote   TEXT,
  document_id      UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  library_item_id  UUID REFERENCES public.library_items(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.entity_relations TO authenticated;
GRANT ALL ON public.entity_relations TO service_role;

ALTER TABLE public.entity_relations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'entity_relations' AND policyname = 'Users access own relations'
  ) THEN
    CREATE POLICY "Users access own relations" ON public.entity_relations
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_entity_relations_source ON public.entity_relations(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_relations_target ON public.entity_relations(target_entity_id);

-- ===== 20260728000004_m4_recipes.sql =====
CREATE TABLE IF NOT EXISTS public.recipes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  steps       JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_builtin  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipes TO authenticated;
GRANT ALL ON public.recipes TO service_role;

ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'recipes' AND policyname = 'Users access builtin or own recipes'
  ) THEN
    CREATE POLICY "Users access builtin or own recipes" ON public.recipes
      FOR ALL USING (is_builtin = true OR auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

INSERT INTO public.recipes (id, user_id, title, description, steps, is_builtin)
VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    NULL,
    'تفسیر کا موازنہ (Compare Tafsir)',
    'کلاسیکی تفاسیر کا تقابلی جائزہ اور اہم نکات کی تلخیص',
    '[
      {"taskSlug": "summarize_sections", "stepLabel": "ابتدائی نصوص کا خلاصہ"},
      {"taskSlug": "citations", "stepLabel": "حوالہ جات و آیات کی تصدیق"},
      {"taskSlug": "formalize", "stepLabel": "علمی و فصیح اسلوب میں فائنل نگارش"}
    ]'::jsonb,
    true
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    NULL,
    'اسناد و روایت کی تحقیق (Hadith Sanad Chain)',
    'حدیث کی راویوں کی تعداد اور اسناد کا تفصیلی تجزیہ',
    '[
      {"taskSlug": "citations", "stepLabel": "راویوں اور کتابوں کے حوالہ جات"},
      {"taskSlug": "humanize", "stepLabel": "روانی اور سلیس اردو میں تدوین"}
    ]'::jsonb,
    true
  ),
  (
    '00000000-0000-0000-0000-000000000003',
    NULL,
    'متعدد مآخذ کی ترسیل و ترکیب (Multi-Source Synthesis)',
    'ذاتی کتب خانے اور عالمی ذخیرے سے نتائج کا یکجا جائزہ',
    '[
      {"taskSlug": "summarize", "stepLabel": "اہم مباحث کا احاطہ"},
      {"taskSlug": "spelling_check", "stepLabel": "املائی و لغوی تصحیح"},
      {"taskSlug": "add_harakat", "stepLabel": "عربی اقتباسات پر اعراب کا لزوم"}
    ]'::jsonb,
    true
  )
ON CONFLICT (id) DO NOTHING;

-- ===== 20260728000005_m4_corpus_owner_filter.sql =====
DROP FUNCTION IF EXISTS public.match_library_chunks(VECTOR(768), FLOAT, INT, UUID[]);

CREATE OR REPLACE FUNCTION public.match_library_chunks(
  query_embedding VECTOR(768),
  filter_user_id  UUID,
  match_threshold FLOAT DEFAULT 0.6,
  match_count     INT   DEFAULT 8,
  filter_item_ids UUID[] DEFAULT NULL
) RETURNS TABLE (
  id UUID,
  library_item_id UUID,
  chunk_index INT,
  content TEXT,
  language TEXT,
  meta JSONB,
  similarity FLOAT
) LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT id, library_item_id, chunk_index, content, language, meta,
         1 - (embedding <=> query_embedding) AS similarity
  FROM public.library_chunks
  WHERE filter_user_id IS NOT NULL
    AND user_id = filter_user_id
    AND embedding IS NOT NULL
    AND (filter_item_ids IS NULL OR library_item_id = ANY(filter_item_ids))
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_library_chunks(VECTOR(768), UUID, FLOAT, INT, UUID[]) TO authenticated;

-- ===== 20260728000006_m4_library_files_bucket.sql (bucket created via storage tool) =====
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

-- ===== 20260728000007_m4_recipes_fixes.sql =====
UPDATE public.recipes
SET steps = '[
  {"taskSlug": "summarize_sections", "stepLabel": "اہم مباحث کا احاطہ"},
  {"taskSlug": "spelling_check", "stepLabel": "املائی و لغوی تصحیح"},
  {"taskSlug": "add_harakat", "stepLabel": "عربی اقتباسات پر اعراب کا لزوم"}
]'::jsonb
WHERE id = '00000000-0000-0000-0000-000000000003';

DROP POLICY IF EXISTS "Users access builtin or own recipes" ON public.recipes;

CREATE POLICY "Anyone reads builtin or own recipes" ON public.recipes
  FOR SELECT USING (is_builtin = true OR auth.uid() = user_id);

CREATE POLICY "Users insert own recipes" ON public.recipes
  FOR INSERT WITH CHECK (auth.uid() = user_id AND is_builtin = false);

CREATE POLICY "Users update own recipes" ON public.recipes
  FOR UPDATE USING (auth.uid() = user_id AND is_builtin = false)
  WITH CHECK (auth.uid() = user_id AND is_builtin = false);

CREATE POLICY "Users delete own recipes" ON public.recipes
  FOR DELETE USING (auth.uid() = user_id AND is_builtin = false);