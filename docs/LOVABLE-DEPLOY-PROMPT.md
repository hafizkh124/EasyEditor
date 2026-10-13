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
   and confirm it contains the text "searchInChunks". Tell me the deployment
   timestamp. (The previous round's "already live" reply was wrong, so please
   verify rather than assume.)

## What changed

- `_shared/chunkedSearch.ts` (new) + `islamic-search/index.ts`: the Tier K
  lexical search (`search_documents_smart` / `search_documents_scoped` RPCs) is
  now sent as up to 4 PARALLEL calls over slices of the term list instead of one
  call. Same RPCs, same SQL, no schema change; only the call pattern differs.
  Reason: measured live, each term costs ~0.35s inside the RPC and the RPC runs
  its terms serially, so 9-12 terms took 5-20s.
```

---

## Notes for you (not for Lovable)

Once deployed, tell Claude; it will re-run sample questions 6, 9, 21 and 23 and compare the `tierK:rpc` timing
compare with the 2026-10-13 baseline (docs/PHASE0-DIAGNOSIS-URDU.md).
