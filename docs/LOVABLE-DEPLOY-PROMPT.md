# Lovable deploy prompt

Copy the block below into Lovable. Everything outside it is notes for you.

**Current round — latest `main`.** One edge function changed: `islamic-search`
(new shared file `_shared/phraseRank.ts`). **No migrations.**

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
   and confirm it contains the text "withPhraseTerm". Tell me the
   deployment timestamp. If you cannot read the deployed source, say so plainly.

## What changed

- `_shared/phraseRank.ts` + `islamic-search/index.ts`, two related changes for an Arabic phrase query:
  (1) the whole phrase is also added as the FIRST lexical search term (Tier K), so the
  rows that really contain it are among the candidates; (2) the ranked list is
  reordered (nothing dropped) so exact-phrase rows come first, Six Books before other
  books. A short-phrase detection bug (13-14 letter phrases were ignored) is fixed.
  Urdu/topical queries are untouched.
```

---

## Notes for you (not for Lovable)

Once deployed, tell Claude; it will re-run the five famous-phrase questions and
check that Sahih Muslim 2694 (query "كلمتان خفيفتان على اللسان") now appears in the
ten sources the model reads, and that Urdu questions are ranked as before.
