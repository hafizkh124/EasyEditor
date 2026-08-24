# Lovable deploy prompt

Copy the block below into Lovable. Everything outside it is notes for you.

**Current round — commit `02cd0e1`.** One edge function file changed
(`verify-renewal-receipt/index.ts`). **No migrations.**

---

```
The GitHub repo's `main` branch has been updated (latest commit 02cd0e1).
Please sync and redeploy the affected Supabase Edge Function.

## What to do

1. Pull the latest `main`.
2. Redeploy `verify-renewal-receipt`.
3. Do NOT create, run, or generate any database migration. This change set
   contains zero schema changes.
4. Do NOT refactor the exported `handle(req)` pattern back into an inline
   `Deno.serve(async (req) => { ... })`. It is exported on purpose so tests can
   call it.

## What changed and why it matters

`verify-renewal-receipt/index.ts` — removed 9 lines of dead code from the
token-reset step of a successful renewal. It used to open with:

    await admin.rpc("credit_tokens", {
      p_user_id: userId,
      p_amount: 1, // placeholder — real reset below
      ...
    });

`credit_tokens` is ADDITIVE — it does `monthly_balance = monthly_balance + p_amount`,
not a set. So this call added 1 token to whatever the user's balance happened to
be at that moment, which the very next line then overwrote anyway with a full
reset to the tier's allocation. The only lasting effect was a row written into
`token_transactions` claiming a "monthly_reset" of amount 1 on every renewal —
a false entry in the table other code (`check-subscription-expiry`) treats as
the authoritative token ledger.

Net effect for users: NONE. The final token balance after a renewal is
unchanged — it was always set correctly by the line immediately after the one
that was removed. This is purely an audit-trail correctness fix: renewals will
stop writing a misleading "+1" line into `token_transactions`.

## After deploying, please confirm

- `verify-renewal-receipt` boots with no import error and answers an OPTIONS
  preflight.
- No migration was created or run.
```

---

## After Lovable reports success

```bash
npm run smoke:functions
```

There is no live-behaviour difference to go looking for this round — the fix
only removes a redundant write, it does not change what a renewal grants a
user. If you want to confirm the audit trail directly: after a real renewal
goes through, query `token_transactions` for that user and confirm there is no
`action_type: 'monthly_reset', amount: 1` row for it.

---

## Earlier rounds (deployed and verified)

- **Round 1** (`eee8fe9`): all 29 functions given an exported `handle(req)`;
  `vector-search` stopped returning `200 {results: []}` for every failure.
  28/29 redeployed, `mcp` picked up on next publish (wrapper-only diff).
  `npm run smoke:functions` 29/29.
- **Round 2** (`dea6fb7`): `citationVerifier`'s apostrophe-class fix (was
  silently dropping real Qur'an citations). `research-query` redeployed.
  29/29.

The two risks called out in round 1 apply to every future round: a missed new
`_shared/` file, and Lovable "tidying" the exported `handle()` back into an
inline `Deno.serve`. Both have held so far.
