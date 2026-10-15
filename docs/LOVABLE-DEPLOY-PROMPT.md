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
   and confirm it contains the text "tierK6:phrase-six-books". Tell me the
   deployment timestamp. If you cannot read the deployed source, say so plainly.

## What changed

- `islamic-search/index.ts` + `_shared/phraseRank.ts`: for an Arabic phrase query, one extra
  fan-out branch ("Tier K6") runs `search_documents_scoped` with that single phrase, hadith
  only, restricted to the Six Books' collections (limit 20). Reason: the canonical rows exist
  (verified: bukhari 110, muslim 5, ibnmajah 2340...) and appear when the user names the book,
  but in an open search the 600-arbitrary-candidates-per-term lexical RPC never reached them.
  Same existing RPC, no schema change. Gated like Tier K's hadith search (off if the user
  turned hadith sources off); Urdu/topical queries do not trigger it.
```

---

## Notes for you (not for Lovable)

Once deployed, tell Claude; it will re-run "من كذب علي متعمدا" and "لا ضرر ولا ضرار" WITHOUT a
book name and check that Bukhari / Muslim / Ibn Majah rows now reach the ten sources the
model reads, and that sources_ready time stays about the same.
