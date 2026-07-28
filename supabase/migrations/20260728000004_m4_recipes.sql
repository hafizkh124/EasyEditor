-- M4 Recipes Database Migration (SPEC-M4 §6 & §4.5)

CREATE TABLE IF NOT EXISTS public.recipes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  steps       JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_builtin  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

-- Insert built-in recipes if not present
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
