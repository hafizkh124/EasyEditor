# Lovable deploy prompt

Copy the block below into Lovable. Everything outside it is notes for you.

**Current round — the Tier K parallel-RPC commit (latest `main`).**
Edge function changed: `islamic-search` only (new shared file
`_shared/chunkedSearch.ts`). **No migrations.**

---

```
The GitHub repo's `main` branch has been updated (use the latest commit on main).
Please sync and redeploy these Supabase Edge Functions:

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
   and confirm it contains the text "computeCountBlock". Tell me the deployment
   timestamp. (The previous round's "already live" reply was wrong, so please
   verify rather than assume.)

## What changed

- `islamic-search/index.ts`: the "exact count" facts (count_term_occurrences RPC,
  only for "how many times" questions) used to start after the whole retrieval
  fan-out had finished. They now start right after the query plan exists and run
  concurrently with the fan-out; the result is awaited only where the prompt is
  built. Same RPC, same guards (still ignored for degraded plans), no schema change.
```

---

## Notes for you (not for Lovable)

Once deployed, tell Claude; it will re-run sample question 21 (a "how many"
question) and compare: before, the `countBlock:rpc` stage ran AFTER `fanOut` and
sources_ready was ~15.6s; now the count should overlap the fan-out.
