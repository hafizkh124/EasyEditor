-- M4 fixes for recipes: a step that cannot run, and a policy that lets any
-- user delete the built-ins for everyone.

-- 1. `summarize` is selection-scoped and not chunkable, so it can never run as
--    a whole-document recipe step — the client now rejects such a recipe
--    up front, which would make this seeded recipe permanently unrunnable.
UPDATE public.recipes
SET steps = '[
  {"taskSlug": "summarize_sections", "stepLabel": "اہم مباحث کا احاطہ"},
  {"taskSlug": "spelling_check", "stepLabel": "املائی و لغوی تصحیح"},
  {"taskSlug": "add_harakat", "stepLabel": "عربی اقتباسات پر اعراب کا لزوم"}
]'::jsonb
WHERE id = '00000000-0000-0000-0000-000000000003';

-- 2. The built-in recipes are global rows (`user_id IS NULL`). The original
--    policy was `FOR ALL USING (is_builtin = true OR auth.uid() = user_id)`,
--    and DELETE only consults USING — so every authenticated user could delete
--    the shared built-ins for the whole instance. Read stays open to all;
--    writing is restricted to rows the user owns.
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
