# Lovable deploy prompt

Copy the block below into Lovable. Everything outside it is notes for you.

**Current round — commit `883b994` + the rijal-discipline commit after it.**
Edge functions changed: `islamic-search`, `refine-text`, `resource-search`
(shared files `sourceScope.ts` new; `queryPlanner.ts`, `disciplines.ts` edited).
**No migrations.**

---

```
The GitHub repo's `main` branch has been updated (latest commit 883b994 or later).
Please sync and redeploy these Supabase Edge Functions:

  - islamic-search
  - refine-text
  - resource-search

(refine-text and resource-search bundle _shared/queryPlanner.ts.)

## What to do

1. Pull the latest `main`.
2. Redeploy the three functions above.
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
- `_shared/queryPlanner.ts` + `_shared/disciplines.ts`: the planner's chosen
  disciplines are now UNIONED with keyword-detected ones, and the prompt/markers
  cover narrator questions (teachers, how many narrations) so the rijal corpus
  is actually searched.
```

---

## Notes for you (not for Lovable)

Once deployed, tell Claude; it will re-run sample questions 6, 8, 9, 21 and 23 and
compare with the 2026-10-13 baseline (docs/PHASE0-DIAGNOSIS-URDU.md).
