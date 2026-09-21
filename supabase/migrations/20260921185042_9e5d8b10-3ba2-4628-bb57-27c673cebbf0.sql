DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  INNER JOIN pg_class rel ON rel.oid = con.conrelid
  INNER JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'user_provider_keys'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%provider%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.user_provider_keys DROP CONSTRAINT ' || quote_ident(constraint_name);
  END IF;

  ALTER TABLE public.user_provider_keys
    ADD CONSTRAINT user_provider_keys_provider_check
    CHECK (provider IN ('gemini', 'groq', 'openrouter', 'cohere'));
END $$;