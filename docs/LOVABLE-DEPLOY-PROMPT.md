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
   and confirm it contains the text "prioritizePhraseHits". Tell me the
   deployment timestamp. If you cannot read the deployed source, say so plainly.

## What changed

- `_shared/phraseRank.ts` (new) + `islamic-search/index.ts`: when the user's query
  is an Arabic phrase of 2+ words, the ranked results are REORDERED (nothing is
  dropped) so rows containing the whole phrase come first, Six Books rows before
  other phrase rows, the rest keep their order. Urdu/topical queries are untouched.
```

---

## Notes for you (not for Lovable)

Once deployed, tell Claude; it will re-run the five famous-phrase questions and
check that Sahih Muslim 2694 (query "كلمتان خفيفتان على اللسان") now appears in the
ten sources the model reads, and that Urdu questions are ranked as before.
