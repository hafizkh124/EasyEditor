# ADR 0044 — Dual Shamela: a cloud `shamela.link` transport beside the local library

**Status:** Accepted · **Date:** 2026-09-09 · **Milestone:** Connectors Hub (Phase 8) · **Extends:** [ADR-0007](./0007-shamela-native-read.md), [ADR-0036](./0036-web-byok.md), [ADR-0037](./0037-connectors-hub-and-curated-registry.md), [ADR-0038](./0038-hybrid-intent-classification-and-tool-gating.md)

## Context

Local Maktaba Shamela (ADR-0007) needs a multi-GB install plus a bundled JRE.
Many scholars don't have it, or don't want it on a small SSD.
**`shamela.link`** is a live, free, hosted MCP server (8,598 books, 3,190 authors,
~34 tools, OAuth BYOA, per-account quota) with good citation discipline (it
won't ascribe a text without reading it; it distinguishes auto-generated from
printed page numbers). A spike confirmed a real streamable-HTTP MCP endpoint at
`https://shamela.link/mcp` with standard MCP-client OAuth.

We want it as a **second transport for the same capability**, never a
replacement: a scholar with a local library keeps using it (offline, instant,
full-text Lucene); a scholar without one gets the cloud.

## Decision

### One capability, two transports, a local-first router

The agent keeps **one** `search_shamela` tool (plus new `read_shamela_page` and
`find_shamela_book`). `electron/agent/adapters/shamelaRouter.ts` decides the
transport per call:

1. **Local enabled** → `searchShamelaNative`. A success — *including a zero-hit
   result* — is the answer; the router returns it and never calls the cloud.
   A zero-hit local search is a legitimate "not in your library", not a failure.
2. Local **disabled or throwing** (no JRE, corrupt index, …) → fall back to the
   cloud (`cloudClient.searchCloud`), with a `note` when it was an error.
3. Neither available → `{ transport: 'none', error }` — dispatch surfaces it, the
   loop degrades, nothing is invented.

`read_shamela_page` routes by the id prefix the caller decoded
(`shamela:` → local first, `shamela-cloud:` → cloud first).
`find_shamela_book` uses the local SQLite catalogue (`catalogue.searchBooks`
against the `masterDbPath` from `detectShamelaInstallation()`, cached for the
dispatcher's life) or the cloud book-search tool.

### The 1:1 tool→connector constraint, worked around narrowly

`TOOL_TO_CONNECTOR` maps each tool to exactly one connector. Rather than fight
that, `shamela-cloud` is registered with **`tools: []`** — it owns nothing in the
map, so `connectorForTool('search_shamela')` still returns `'shamela'`. A small
`MULTI_OWNER_TOOLS` table (`search_shamela` / `read_shamela_page` /
`find_shamela_book` → `['shamela', 'shamela-cloud']`) drives `isToolDisabled`:
one of these tools is off only when **every** owner is off. `connectorsUsed`
(provenance) reads the result's `transport` field: `local → shamela`,
`cloud → shamela-cloud`, `none → skip`.

Intent gating (ADR-0038) stays **transport-agnostic** — no
`DomainRule.connector: 'shamela-cloud'` exists, so a Shamela-scoped ask exposes
`search_shamela` regardless of which transport will serve it.

### OAuth: MCP SDK `OAuthClientProvider` + DCR + PKCE + a loopback redirect

`electron/shamela/cloudOAuth.ts` implements `OAuthClientProvider`:

- **Public native client**, `token_endpoint_auth_method: 'none'`, PKCE only,
  dynamic client registration (DCR).
- **Redirect: `http://127.0.0.1:{43110|43111|43112}/callback`** (RFC 8252), a
  one-shot `node:http` server that accepts only `/callback` (404 else), verifies
  `state`, serves static HTML (never echoes a request value), and `close()`s
  after the first hit or on quit. All three ports are registered as redirect
  URIs; the first that binds wins. The `easyeditor://` custom scheme is
  **deliberately not reused** — it is blindly forwarded to the renderer for the
  Supabase sign-in and has no path discrimination.
- The dance in `cloudClient.connectCloud()`: first `client.connect` throws
  `UnauthorizedError` (the SDK ran `auth()` → our `redirectToAuthorization`
  opened the browser + the loopback) → `await waitForLoopbackCode()` →
  `transport.finishAuth(code)` (token exchange + `saveTokens`) → reconnect with a
  fresh client/transport. A quiet reconnect with a saved refresh token never
  throws `UnauthorizedError`.
- **Tokens live only in `safeStorage`-encrypted `.enc` blobs under `userData`**
  (`electron/ai/keyStore.ts` pattern), decrypted only in the main process. No IPC
  returns a token; `cloudStatus()` is booleans only (ADR-0036 principle). The
  code verifier and `state` are in-memory per-flow.

### The `shell.openExternal` allowlist exception

`redirectToAuthorization` opens the authorize URL directly, bypassing
`isAllowedExternalUrl` (`shamela.link` is **not** added to the host allowlist). A
reviewed exception because: (a) `https:` is asserted; (b) the URL is built by the
MCP SDK's `startAuthorization()` from RFC 8414 discovery of the **hardcoded**
`CLOUD_ENDPOINT`, never from renderer or tool input; (c) it is only reachable
from an `UnauthorizedError` on a transport pointed at that same hardcoded
endpoint; (d) it opens in the real browser, never an embedded `BrowserWindow`.

### Provisional tool names → a live `listTools()`

`shamela.link/mcp` exposes ~34 tools; the exact names/arg shapes are unknown
until we authenticate. `electron/shamela/cloudAllowlist.ts` ships a **provisional**
5-tool allowlist mirroring the vendored `shamela-mcp` (`shamela_search_pages`
etc.). It is the single source of truth: the live OAuth test
(`docs/manual/shamela-cloud-oauth-check.md`, action `listTools`) pins the real
names into that file, and the `normaliseCloud*` helpers in `cloudClient.ts` are
adjusted to match. The normalisers already tolerate both `structuredContent`
rows and a plain text blob (which degrades to one `bibliographic` chunk so a
citation is still possible — the repositories pattern).

### Desktop only

The loopback server + `safeStorage` are main-process. Web support needs an
edge-function proxy (à la `tafsir-proxy`, ADR-0012) and is a follow-up.

## Consequences

**Positive**
- A scholar with no local library gets 8,598 books, free, after a one-time
  browser sign-in — the Hub card + the "المكتبة الشاملة" settings section carry
  both transports.
- The agent surface is unchanged: one `search_shamela`, one set of domain rules,
  one provenance mechanism. Provenance chips distinguish the source
  (`💻 الشاملة (مقامی)` vs `☁️ شامله لنک`).
- Local stays primary — offline, instant, no quota — whenever it is present.

**Negative**
- A mid-run token expiry the SDK can't refresh away → `callTool` throws a clean
  "reconnect from Settings" message (Arabic), the router falls back to local,
  and **no browser pops mid-run**. The user re-links from the panel.
- Per-account cloud quota (429) → a clean "quota exceeded, retry shortly"
  message, no auto-retry.
- The provisional allowlist means the cloud path is not proven until the live
  test is run once against a real `shamela.link` account.
- `shell.openExternal` bypassing the host allowlist is a real (reviewed)
  exception to the ADR-era external-URL discipline.

## Alternatives rejected

- **`easyeditor://shamela/callback` custom-scheme redirect** — the existing
  handler forwards blindly to the renderer with no path discrimination; a
  loopback server is self-contained and does the token exchange in the main
  process. (Kept as a documented Plan B if `shamela.link` refuses a loopback
  redirect URI in DCR.)
- **Split `search_shamela_local` / `search_shamela_cloud`** — two tools for one
  capability; the model would have to know which library the user has. The
  router hides that.
- **Replace the local library with the cloud** — offline scholars, quota, and
  latency all argue against it. Local-first, cloud-fallback.

## Follow-ups

- The live OAuth test → pin real tool names in `cloudAllowlist.ts`, fix
  `normaliseCloud*`, re-run the SDK-mocked tests.
- Web parity: an edge-function proxy for `shamela.link` under the M10 milestone.
- Optionally import fetched cloud pages into the personal corpus (needs a
  provenance/licence decision — deferred).
