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
   and confirm it contains the text "const chunkLimit = limit". Tell me the deployment
   timestamp. (The previous round's "already live" reply was wrong, so please
   verify rather than assume.)

## What changed

- `_shared/chunkedSearch.ts`: each parallel chunk of the Tier K lexical search
  now asks the RPC for the SAME `p_match_limit` (30) instead of 60. The RPCs
  derive a per-term candidate cap of `p_match_limit * 20` rows, so 60 had been
  doubling every branch's work to 1200 rows. No schema or SQL change.
```

---

## Notes for you (not for Lovable)

Once deployed, tell Claude; it will re-run sample questions 6, 9, 21 and 23 and compare the `tierK:rpc` timing
(still labelled "..., N calls"; the check this time is that the stage is faster than
before: Q6 was 7.0s, Q9 8.7s, Q23 14.5s)
compare with the 2026-10-13 baseline (docs/PHASE0-DIAGNOSIS-URDU.md).
