# Lovable deploy prompt

Copy the block below into Lovable. Everything outside it is notes for you.

**Current round — latest `main`.** One edge function changed: `islamic-search`.
**No migrations.** (The rest of this round is front-end only and ships with the web build.)

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
   and confirm it contains the text "more_citations". Tell me the deployment
   timestamp. If you cannot read the deployed source, say so plainly.

## What changed

- `islamic-search/index.ts`: the final ranking now keeps 25 results instead of 10.
  The first 10 go to the model exactly as before (same ranking prefix, same
  context block, same [N] numbering); results 11-25 are sent to the client only,
  in a new `more_citations` array on the `sources_ready` event, with passages cut
  to 600 chars. They are browse-only: never given to the model, never cited.
```

---

## Notes for you (not for Lovable)

Once deployed, tell Claude; it will check that `sources_ready` carries up to 15
`more_citations`, and look at the new "show N more results" fold in the app.
