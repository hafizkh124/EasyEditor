# Edge Function Smoke Tests

A single command that proves every Supabase Edge Function is **deployed, booting,
and reachable from the browser**. Run it immediately after any deploy.

```bash
npm run smoke:functions              # all functions, human-readable table
npm run smoke:functions -- transcribe refine-text   # only these
npm run smoke:functions:json         # machine-readable (CI, dashboards)
```

Exit code is `0` when everything passes and `1` when anything fails, so it can
gate a pipeline directly.

## What each function is checked for

| Check | Why it matters |
| --- | --- |
| **CORS preflight** (`OPTIONS`) returns 2xx **with** `Access-Control-Allow-Origin` | Without it the browser refuses the call — the function looks "broken" even though it works via curl. |
| **Live invocation** returns an expected status | A `404` means the function was never deployed. A `5xx` with `BOOT_ERROR` / `Module not found` means an import broke (this is exactly how the `shared/` import bug shipped silently). |
| **Response body scan** | Boot and worker-limit errors can arrive inside a 2xx-looking envelope; the runner greps for them explicitly. |

### What counts as a pass

The runner tests **liveness, not business logic**. It sends a harmless payload
with only the anon key, so the healthy answers are:

- `401` / `403` — deployed, booted, correctly rejecting an unauthenticated caller
- `400` / `422` — deployed, booted, correctly validating input
- `200` — deployed and happy

Anything else (`404`, `5xx`, timeout, network error, missing CORS header) fails.

Per-function overrides live in the `PROBES` map in
`scripts/smoke-edge-functions.mjs`. Cron/admin functions (`reset-monthly-quotas`,
`process-email-queue`, `check-subscription-expiry`, `backfill-embeddings`,
`ingest-*`) are given payloads that **never** run their work path, so smoke tests
cost no tokens and mutate nothing.

Functions deployed with `verify_jwt = true` are rejected by the platform gateway
*before* the function runs — even for `OPTIONS`. Those are listed in
`GATEWAY_JWT` and their CORS check is skipped as not applicable.

## Environment

Read from `.env` / `.env.local` or the shell:

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | yes | Project endpoint |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | yes | Anon key |
| `SMOKE_ACCESS_TOKEN` | no | A real user JWT. When set, auth-gated functions are exercised past the `401` wall instead of stopping at it. |
| `SMOKE_TIMEOUT_MS` | no | Per-request timeout, default `30000`. |

## Adding a new function

Nothing to do — the runner discovers every directory under
`supabase/functions/` that has an `index.ts` (skipping `_shared`). Add a `PROBES`
entry only if the default expectations don't fit.

## CI

`.github/workflows/smoke-edge-functions.yml` runs the suite on every push that
touches `supabase/functions/**`, daily at 06:00 UTC, and on demand. It waits 60s
after a push so it doesn't race the deploy rollout, and uploads
`smoke-report.txt` as an artifact.

Repository secrets required: `VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY`, and optionally `SMOKE_ACCESS_TOKEN`.
