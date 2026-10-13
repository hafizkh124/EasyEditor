# Lovable deploy prompt

Copy the block below into Lovable. Everything outside it is notes for you.

**Current round — commit `883b994`.** One edge function changed: `islamic-search`
(plus one new shared file it imports). **No migrations.**

---

```
The GitHub repo's `main` branch has been updated (latest commit 883b994 or later).
Please sync and redeploy this Supabase Edge Function:

  - islamic-search

## What to do

1. Pull the latest `main`.
2. Redeploy `islamic-search`.
3. Do NOT create, run, or generate any database migration. This change set
   contains zero schema changes.
4. Do NOT refactor the exported `handle(req)` pattern back into an inline
   `Deno.serve(async (req) => { ... })`. It is exported on purpose so tests can
   call it.
5. After deploying, open the DEPLOYED source of `islamic-search` (not the repo)
   and confirm it contains the text "dropQuranRows". Tell me the deployment
   timestamp. (The previous round's "already live" reply was wrong, so please
   verify rather than assume.)

## What changed

- `_shared/sourceScope.ts` (new): when the query planner is confident the user
  asked for hadith only, Qur'an rows are dropped.
- `islamic-search/index.ts`: Tier K skips the Qur'an source type for such
  queries, and the merged result list is filtered with `dropQuranRows`.
```

---

## Notes for you (not for Lovable)

Once deployed, tell Claude; it will re-run sample questions 6, 8 and 9 and
compare with the 2026-10-13 baseline (docs/PHASE0-DIAGNOSIS-URDU.md).
