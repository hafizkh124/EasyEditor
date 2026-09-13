# ADR 0053 — Desktop Google Sign-In via a Device-Link Flow

**Status:** Accepted · **Date:** 2026-09-13

## Context

The desktop app's "Continue with Google" button (`DesktopAccountMenu.tsx`)
called `src/lib/desktopOauth.ts`'s `startDesktopOauth`, which hits Supabase's
native `supabase.auth.signInWithOAuth()` directly — the only option for a
`file://`-loaded Electron renderer, which has no origin an OAuth provider can
redirect back to, so the flow opens the consent page in the system browser
and waits for an `easyeditor://auth/callback` deep link.

That call fails in production with `"Unsupported provider: missing OAuth
secret"`. The project's Google sign-in only works through Lovable's own
managed OAuth broker (`lovable.auth.signInWithOAuth`, used by the web app's
Login/Signup pages) — Lovable mediates the browser redirect itself and never
exposes real Google Cloud credentials to the project. Confirmed directly with
Lovable: there is no supported way to add our own Google Cloud OAuth client
to their managed Google provider ("Managed by Lovable" is the only working
mode; "Your own credentials" is not available on Lovable Cloud), and the only
way to own those credentials outright would be migrating off Lovable's
managed Supabase project entirely — out of proportion for an optional,
desktop-only sign-in button. The desktop app is offline-first by design
(`ProtectedRoute.tsx`'s `allowGuest`); email/password sign-in already works
there today, unaffected by any of this.

## Decision

A device-authorization-grant-style flow (RFC 8628, adapted to Supabase
sessions) — the same pattern GitHub CLI / Docker Desktop / VS Code use for a
native app that cannot itself embed a provider's OAuth redirect:

1. Desktop calls `device-link`'s `create` action (unauthenticated — no
   session exists yet) for an 8-char Crockford-base32 code, 10-minute expiry.
2. Desktop opens `https://editor.alulama.org/connect-device?code=…` in the
   system browser (the existing `openExternal` IPC bridge — no new IPC).
3. The user signs in there with the web app's *already-working* Google
   button (or email/password) and approves the code. The new `/connect-device`
   page (`ConnectDevice.tsx`) calls `confirm`, authenticated — the caller's
   own verified JWT supplies `user_id`, so a client can never confirm a code
   as anyone but themselves.
4. Desktop, polling `status` every ~2.5s: once `confirmed`, the function
   (service-role) resolves the user's email, calls
   `admin.generateLink({ type: 'magiclink', email })`, and immediately marks
   the row `claimed` — one hand-off, ever, per code. Desktop redeems the
   returned `hashed_token` via `supabase.auth.verifyOtp({ token_hash, type:
   'magiclink' })`, and `AuthContext`'s existing `onAuthStateChange` picks up
   the session exactly like any other sign-in.

No raw access/refresh token ever sits in the database — only the short-lived
code does. Security rests on three layers: ~40 bits of code entropy, a
10-minute expiry, and rate limiting (`_shared/rateLimit.ts`) keyed by both
the code and the caller's IP on every action.

`src/lib/desktopOauth.ts` (and its `easyeditor://` deep-link consumer in
`AuthContext.tsx`) is deleted — nothing calls it any more. The underlying
`easyeditor://` protocol registration in `electron/main.ts`/`preload.ts`/
`registry.ts` is left in place (harmless unused infrastructure); touching
native OS protocol registration was out of scope for this fix.

## Consequences

- New table `device_link_codes` (migration
  `20260913120000_device_link_codes.sql`) — RLS enabled, no policies, same
  service-role-only shape as `user_provider_keys` (only the edge function
  ever touches it).
- New edge function `supabase/functions/device-link/index.ts`.
- New `src/lib/desktopDeviceLink.ts` (desktop half), `src/pages/
  ConnectDevice.tsx` + `/connect-device` route (web half, `ProtectedRoute`d).
- `DesktopAccountMenu.tsx`'s `SignInForm` gains a waiting/code/cancel state
  (`GoogleDeviceLinkWait`) instead of a plain spinner.
- `electron/lib/urlAllowlist.ts`: `accounts.google.com` (the old flow's
  entry) replaced with `editor.alulama.org`.
- Tests: `deviceLinkFunction.test.ts` (16 cases — create, status transitions
  including the confirmed→claimed single-mint hand-off, the auth wall and
  own-user_id binding on confirm, expiry, validation). `fakeSupabase.ts`
  gained `auth.admin.getUserById`/`auth.admin.generateLink` support (nobody
  had called either yet).
- **Not yet live-verified end to end** — needs a deployed edge function/
  migration (Lovable-applied, this repo cannot push either directly) plus a
  real desktop build to open a real system browser. Recommend one real
  device-link sign-in before considering this fully closed.
