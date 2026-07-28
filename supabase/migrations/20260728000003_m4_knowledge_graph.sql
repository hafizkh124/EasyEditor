-- M4 Knowledge Graph Database Migration (SPEC-M4 §5 & §4.3)

-- 1. Entities table
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

-- 2. Entity Relations table
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
