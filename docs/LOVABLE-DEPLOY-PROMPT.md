# Lovable deploy prompt

Copy the block below into Lovable. Everything outside it is notes for you.

**Current round — latest `main`.** One new migration: `20261020120000_citation_feedback.sql`
(table `citation_feedback`). **No edge function changed in this round.**

---

```
The GitHub repo's `main` branch has been updated (use the latest commit on main).
Please sync and apply exactly ONE database migration:

  - supabase/migrations/20261020120000_citation_feedback.sql

## What to do

1. Pull the latest `main`.
2. Apply the migration above, as written in the repo. Do not rewrite it, rename it,
   or generate any other migration. It creates `public.citation_feedback`.
3. Do NOT regenerate or overwrite `src/integrations/supabase/types.ts` — it already
   contains a hand-added `citation_feedback` entry that matches the migration. If your
   generator produces a different shape, keep the repo's version and tell me what differs.
4. Confirm the edge function `islamic-search` is the latest version from `main`. Open the
   DEPLOYED source (not the repo) and check it contains the text "demote quran+weak behind
   hadith". Redeploy it ONLY if that text is missing. Do NOT refactor the exported
   `handle(req)` pattern back into an inline `Deno.serve(async (req) => { ... })` — it is
   exported on purpose so tests can call it.
5. Do not touch any other function, table or policy.

## What the migration does

`citation_feedback` stores a scholar's Approve / Edit & Correct feedback on AI citations
(columns: id, user_id → auth.users, action 'approve'|'correct', source_id, verify_status,
original jsonb, corrected jsonb, consent_training boolean default false, created_at).
Row Level Security is ON with exactly two policies: a user can SELECT and INSERT only their
own rows (auth.uid() = user_id). There is deliberately no update or delete policy.
A check constraint `citation_feedback_correct_has_payload` requires `corrected` when
action = 'correct'.

## Please report back

- The applied migration name and timestamp.
- The table's columns, its RLS status, and its two policy names.
- That the `citation_feedback_correct_has_payload` check constraint exists.
- The `islamic-search` deployed state (current, or redeployed with a timestamp). If you
  cannot read the deployed source, say so plainly.
```

---

## Notes for you (not for Lovable)

- Lovable syncs from `main`. The work is on branch `ccr-8863bd66-qkvxe6`; merge it to `main`
  first (or ask Claude to open a PR), otherwise Lovable will not see the migration.
- Until the migration is applied, Approve / Edit feedback is kept in the browser's local queue
  and sent automatically on a later signed-in session, so nothing is lost.
- Once Lovable confirms, tell Claude; it will check the desktop and web flows.
