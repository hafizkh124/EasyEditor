# Lovable deploy prompt

Copy the block below into Lovable. Everything outside it is notes for you.

**Current round — latest `main`.** One edge function changed: `islamic-search`
(new shared file `_shared/rulingRank.ts`). **No migrations.**

---

```
The GitHub repo's `main` branch has been updated (use the latest commit on main).
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
   and confirm it contains the text "demote quran+weak behind hadith". Tell me the
   deployment timestamp. If you cannot read the deployed source, say so plainly.

## What changed

- `islamic-search/index.ts` + `_shared/rulingRank.ts`: after the rerank, Qur'an verse rows and
  weak/fabricated-graded hadith rows are moved BEHIND the other results (reorder only, nothing
  dropped; topic anchors stay first; skipped when the question itself asks for verses/tafsir).
  Reason: judged live, a practical question like "نماز میں بچے کو اٹھانے کا حکم" spent 4 of its
  first 10 slots on verses sharing one word. Pure ordering, no schema change.
```

---

## Notes for you (not for Lovable)

Once deployed, tell Claude; it will re-run the 6 judged questions and compare against your marks.
