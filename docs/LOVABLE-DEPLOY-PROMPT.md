# Lovable deploy prompt

Copy the block below into Lovable. Everything outside it is notes for you.

**Current round — the Tier K parallel-RPC commit (latest `main`).**
Edge functions changed: `islamic-search` and `vector-search`
(plus the `IslamicResult` type in `islamic-api-fetch`). **No migrations.**

---

```
The GitHub repo's `main` branch has been updated (use the latest commit on main).
Please sync and redeploy these Supabase Edge Functions:

  - islamic-search
  - vector-search
  - islamic-api-fetch

## What to do

1. Pull the latest `main`.
2. Redeploy the three functions above.
3. Do NOT create, run, or generate any database migration. This change set
   contains zero schema changes.
4. Do NOT refactor the exported `handle(req)` pattern back into an inline
   `Deno.serve(async (req) => { ... })`. It is exported on purpose so tests can
   call it.
5. After deploying, open the DEPLOYED source of `islamic-search` (not the repo)
   and confirm it contains the text "content_ar:   passageForClient". Tell me the deployment
   timestamp. (The previous round's "already live" reply was wrong, so please
   verify rather than assume.)

## What changed

- `IslamicResult` gains an optional `content_ar` (Arabic matn). `vector-search`
  (rowToIslamicResult) and every `islamic-search` tier that already computed
  `has_matn` now also pass the Arabic text through, and `sources_ready` carries it
  (<=1200 chars) as `content_ar` next to `content`. Previously corpus rows' `content`
  was often the Urdu translation and the Arabic never reached the client.
```

---

## Notes for you (not for Lovable)

Once deployed, tell Claude; it will re-run Q1-Q5 and check that `sources_ready` now
has a `content_ar` field per source (Arabic matn), then confirm how the new panel
looks in the app.
