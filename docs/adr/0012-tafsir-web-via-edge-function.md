# ADR 0012 — Tafsir MCP on Web via a Session-less Edge Function

**Status:** Accepted (decision) · **Date:** 2026-08-15 · **Milestone:** SPEC-TAFSIR Phase 4 (§FR-6, resolves §8.5.2 / FR-6.4)

## Context

`SPEC-TAFSIR.md` §5 records four key decisions for the desktop build:

1. The MCP client lives **only in the Electron main process** — solves CSP
   and CORS in one shot, and keeps the renderer's attack surface small
   (NFR-2).
2. The renderer never needs to know the remote endpoint — only the known
   `tafsir:invoke` IPC API.
3. The tool whitelist is populated dynamically from the server's
   `tools/list`, but the renderer only ever sees names + arg schemas, never
   executes anything itself.
4. Mode switching (remote ↔ local) is always the user's choice, never
   automatic (Principle 3).

Decision 1 is what structurally blocks web: a browser tab has no Electron
main process to host the MCP client in. `tafsirService.ts` (the renderer
facade) already anticipates this — every method throws a "desktop only"
error when `window.electronAPI.tafsir` is absent — and `TafsirConnector.tsx`
hides itself entirely on web (`hasTafsirNative()`) rather than show a connect
button guaranteed to fail, following the same "a feature that cannot work is
absent, not broken" rule the Shamela bridge connector was fixed to follow
(2026-08-15, same day).

The spec itself already sketched the shape of a fix — §FR-6 describes a
Supabase Edge Function `tafsir-proxy` as the main-process's web counterpart
— but left it an open decision (§8.5.2, FR-6.4): "does the edge function get
built, or does web just point users at the desktop app?", deferred until
after the desktop build shipped ("پہلے ڈیسک ٹاپ مکمل ہوگا"). The desktop
build is done (§12.2–12.4 all checked). Given assumption 6 in the same spec
— most users are on web, not desktop — leaving Tafsir permanently
desktop-only would mean the majority of users never get it at all.

## Decision

Build `supabase/functions/tafsir-proxy` as the web counterpart to
`electron/tafsir/mcpClient.ts`, reusing the existing code where it is
already portable rather than rewriting it:

- **`electron/tafsir/allowlist.ts` moves over unchanged.** It has zero
  Electron/Node dependencies today (pure functions, already unit-tested) —
  the same 17-tool whitelist and argument sanitizer apply verbatim to the
  edge function.
- **The remote-transport half of `mcpClient.ts`** (`connectRemote`,
  `pingRemote`, `callTool`) is portable in spirit — same
  `StreamableHTTPClientTransport` from `@modelcontextprotocol/sdk`, same
  `fetch`-based remote call — but is **not** copied as-is, because of one
  concurrency mismatch the original spec didn't need to consider:

  **The desktop client holds a module-level singleton `session`** — one
  live connection, reused across calls, torn down on `disconnect`/app-quit.
  That is correct for one main process serving one desktop user. An edge
  function serves many concurrent web users from a warm, possibly-shared
  isolate; a module-level singleton session there would let one user's
  in-flight call observe or clobber another's.

  The fix costs nothing functionally: the spike (§10.4) already confirmed
  `mcp.tafsir.net` is **stateless** — no `Mcp-Session-Id`, every POST is
  self-contained. So `tafsir-proxy` does not hold a session at all: each
  invocation does `connect → listTools/callTool → disconnect` against a
  fresh `Client`, request-scoped, nothing shared between invocations. This
  is simpler than the desktop code, not just a port of it.
- **The local/stdio path is not touched.** `connectLocal`,
  `terminateLocalSync`, and all of `localRuntime.ts` stay desktop-only, as
  the original spec's Non-Goals already state ("مقامی موڈ کا Web ورژن" —
  out of scope). `TafsirConnector`'s mode radio should only ever offer
  "remote" on web (already specified, FR-6.3) — nothing new to decide
  there.
- **Behind `tokenGuard`**, per the spec's own FR-6.2. Desktop Tafsir calls
  cost the project nothing — they go directly from the user's machine to
  the third-party server. Web calls now route through, and are billed
  against, this project's own Supabase edge-function invocations and
  outbound bandwidth, so they need the same cost gate every other paid
  capability has.

## What is reversed, and what is not

| From §5's four decisions | Web treatment |
|---|---|
| 1. MCP client only in Electron main process | **Reversed for the remote path only** — also lives in `tafsir-proxy` (Deno). Local/stdio stays main-process/desktop-only, unreversed. |
| 2. Renderer never knows the remote endpoint | **Unchanged in spirit.** The renderer calls `tafsir-proxy`, not `mcp.tafsir.net` directly — CORS and endpoint-privacy (FR-6.1, NFR-1) hold exactly as before, just with an edge function standing where the main process stood. |
| 3. Whitelist enforced server-side, renderer never executes freely | **Unchanged.** `allowlist.ts` runs inside `tafsir-proxy`, not the renderer — same NFR-2 guarantee, same code. |
| 4. Mode switching is the user's choice | **Unchanged, and simplified.** Web has no mode to switch — remote is the only option, so this decision doesn't apply rather than being reversed. |

## Consequences

- **New coupling to third-party uptime, at project scale.** Today a
  `tafsirmcp.netlify.app` outage affects individual desktop installs
  independently. Once `tafsir-proxy` ships, it affects every web user
  simultaneously, and an outage there now reads as "this project's Tafsir
  feature is down" rather than "a third-party server is down" — worth
  monitoring for, not just building past.
- **Real, ongoing cost**: edge-function invocations and outbound fetch
  bandwidth scale with Tafsir usage on web, unlike the free-to-us desktop
  path. This is why FR-6.2's `tokenGuard` requirement is load-bearing, not
  optional polish.
- **CC BY 4.0 attribution (FR-7)** is unaffected by transport — the footer
  requirement applies identically whether the text arrived via IPC or via
  the edge function.
- **Implementation reuses, rather than rewrites**, the bulk of the
  desktop's already-tested logic: `allowlist.ts` verbatim, and
  `connectRemote`/`callTool`'s request shape ported to a stateless
  per-invocation form. The desktop code is not itself changed by this
  decision.
- **This ADR records the decision, not the implementation.** Building
  `supabase/functions/tafsir-proxy`, adding the web branch to
  `tafsirService.ts`, and un-gating `TafsirConnector.tsx` for web
  (`hasTafsirNative()` currently returns `false` there by design) are
  follow-up work, tracked separately.
