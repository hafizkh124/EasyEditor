# Lovable deploy prompt

Copy the block below into Lovable. Everything outside it is notes for you.

**Current round — latest `main` (PR #10, UI/UX 2026).** Two new migrations:
`20261021000000_research_sessions_folder.sql` and `20261022000000_translation_review.sql`.
**One edge function changed:** `refine-text` (its `summarize_sections` prompt).

---

```
The GitHub repo's `main` branch has been updated (use the latest commit on main).
Please sync, apply exactly TWO database migrations, and redeploy ONE edge function.

## Migrations — apply in this order, as written in the repo

  1. supabase/migrations/20261021000000_research_sessions_folder.sql
  2. supabase/migrations/20261022000000_translation_review.sql

Do not rewrite, rename or merge them, and do not generate any other migration.
Both are additive (ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS); no existing
row, column, table, policy or function is changed.

What they do:
- 20261021000000: adds `research_sessions.project_id uuid` (nullable, REFERENCES
  public.projects(id) ON DELETE SET NULL) and the index
  `research_sessions_user_project_idx` on (user_id, project_id, updated_at DESC).
  A chat now belongs to the folder it was started in.
- 20261022000000: adds `translation_projects.glossary jsonb NOT NULL DEFAULT '[]'`,
  `translation_projects.style text NOT NULL DEFAULT 'idiomatic'` with a CHECK
  (style IN ('idiomatic','literal')), and `translation_chunks.reviewed integer[]
  NOT NULL DEFAULT '{}'`. Used by the translation glossary, style and review marks.

Do NOT regenerate or overwrite `src/integrations/supabase/types.ts`. The client reads
these columns through its own types and retries without them if they are missing, so
the repo's types file must stay as it is.

## Edge function — redeploy ONE

  - refine-text

Its shared prompt file changed (supabase/functions/_shared/mirror/ai/prompts/refineText.ts,
action `summarize_sections`: it now summarizes ONE section, which the editor inserts under
that section). After deploying, open the DEPLOYED source and confirm it contains the text
"Your summary is inserted directly after the section". Do NOT refactor the exported
`handle(req)` pattern back into an inline `Deno.serve(async (req) => { ... })`.

Do not touch any other function, table, policy or bucket.

## Please report back

- Both applied migration names and timestamps, in order.
- The new columns with their types and defaults: research_sessions.project_id,
  translation_projects.glossary, translation_projects.style, translation_chunks.reviewed;
  that the `style` check constraint and `research_sessions_user_project_idx` exist.
- The refine-text deployed state (redeployed with a timestamp) and whether the deployed
  source contains the sentence above. If you cannot read the deployed source, say so plainly.
```

---

## Notes for you (not for Lovable)

- Lovable syncs from `main`; this round reaches it once PR #10 is merged.
- Until the migrations are applied the app still works: chats simply are not tied to a
  folder, and a translation's glossary, style and review marks are not saved.
- Until `refine-text` is redeployed, "summarize each section" in the editor may write a
  summary that does not fit under one section (the old prompt).
- Once Lovable confirms, check these live once: extract text from an image, translate one
  page, and in the desktop app (Word) run section summaries on a chapter.
