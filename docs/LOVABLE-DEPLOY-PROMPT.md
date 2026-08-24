# Lovable deploy prompt — commit 48113a9

Copy the block below into Lovable. Everything above and below it is notes for
you, not for Lovable.

**What this is:** `main` was updated with two commits (`35ee104`, `48113a9`)
that touch all 29 edge functions. There are **no database migrations** — do not
let Lovable create any.

---

```
The GitHub repo's `main` branch has been updated (latest commit 48113a9).
Please sync and redeploy the Supabase Edge Functions.

## What to do

1. Pull the latest `main`.
2. Redeploy ALL Supabase Edge Functions. 29 function files changed.
3. Do NOT create, run, or generate any database migration. This change set
   contains zero schema changes, and none are needed.

## Important: a new shared file must ship with the deploy

`supabase/functions/_shared/receiptDecision.ts` is NEW.

`verify-receipt` and `verify-renewal-receipt` both import it:

    import { decideActivation, TIER_PRICES_PKR, type PaidTier }
      from "../_shared/receiptDecision.ts";

If that file is not included in the deployed bundle, both functions will fail
to boot with an import error. Please confirm it is present after deploying.

## Do not "clean up" the new handler pattern

Every function now looks like this, and it is intentional:

    export async function handle(req: Request): Promise<Response> { ... }

    Deno.serve(handle);   // or: serve(handle);

The handler is exported on purpose so it can be called from tests. Please do
NOT refactor it back into an inline `Deno.serve(async (req) => { ... })`. 26 of
the 29 functions changed ONLY in this way — the request logic inside is
byte-for-byte unchanged.

## The 3 functions with real behaviour changes

Everything else is the wrapper change above. These three also changed:

1. `vector-search` — it used to return `200 {results: []}` for EVERY failure,
   which was indistinguishable from a successful search that matched nothing.
   Now:
   - a malformed/unparseable JSON body returns `400 {error: "Invalid JSON body"}`
     (it already returned 400 for a missing `query`);
   - the three genuine degradation paths still return `200`, but now include
     `degraded: true` and a `reason` field ("rpc_error", "embedding_failed",
     "internal_error"). The `results` array is still there and still first, so
     existing callers keep working.

2. `verify-receipt` and 3. `verify-renewal-receipt` — the auto-approval
   decision moved into the shared `receiptDecision.ts` (it was previously
   duplicated verbatim in both files). One deliberate behaviour change: the
   receiver check now requires the AI-extracted receiver to be at least 6
   characters before it will match as a fragment of a known account. Previously
   an unreadable receiver field of "" or "0" matched a real account, because ""
   is a substring of everything and "0" is a substring of "00420745" — so a
   receipt with the right amount and high confidence but an unreadable payee
   could be auto-approved. Such receipts now go to manual review instead. The
   response also gains a `failed_checks` array in
   `ai_verification_details`, listing why a receipt was not auto-approved.

## After deploying, please confirm

- All 29 functions report as deployed and booting (no import errors).
- `_shared/receiptDecision.ts` is present in the deployment.
- `verify-receipt` and `verify-renewal-receipt` respond to an OPTIONS
  preflight with `Access-Control-Allow-Origin` (i.e. they booted).
- No migration was created or run.
```

---

## After Lovable reports success

Run the repo's own post-deploy check from this machine:

```bash
npm run smoke:functions
```

It probes every function for "deployed, boots, answers CORS preflight" and exits
non-zero on any failure. `smoke-edge-functions.yml` also runs it automatically
on push to `main`, so GitHub Actions will report independently.

Then verify the one user-visible change by hand: run a normal research query and
confirm results still appear (that exercises `vector-search` through
`islamic-search`). Status codes are the only place an existing client could
break.
