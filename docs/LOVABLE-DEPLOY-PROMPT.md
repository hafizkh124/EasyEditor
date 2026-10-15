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
   and confirm it contains the text "languageInstruction". Tell me the
   deployment timestamp. If you cannot read the deployed source, say so plainly.

## What changed

- `islamic-search/index.ts` + new `_shared/mirror/research/answerLanguage.ts`: the system
  prompt now detects the language of the question (Urdu / Arabic / English from the
  letters used) and states it outright: "Write your answer in <language>", unless the
  scholar explicitly asks for another language; quotations stay in their original
  language. Before, an Arabic question was answered in English because the only rule
  was one buried line and the context block is English-labelled.
```

---

## Notes for you (not for Lovable)

Once deployed, tell Claude; it will ask an Arabic question and an Urdu one and check the
language of each answer, plus one with an explicit "answer in English".
