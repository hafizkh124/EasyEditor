# ADR 0036 — Web BYOK (bring your own key)

**Status:** Accepted · **Date:** 2026-09-08 · **Milestone:** M10 §2.5 · **Extends:** [ADR-0031](./0031-m9-multi-provider.md)

## Context

ADR-0031 gave desktop scholars a way to run the agent on their own free-tier
Gemini/Groq/OpenRouter key instead of the app's paid infrastructure — a real
cost saving, since a free tier that clears the loop eval (ADR-0030) performs
identically for citation integrity. The user's own explicit ask for this
milestone: bring that same saving to web, since the desktop-only local voice
models (Piper/Whisper) can never reach web, but a cloud provider key can.

Desktop's `ByokKeyPanel.tsx` turned out considerably richer than a first
glance suggested: it stores a key per provider, but ALSO lets a scholar pick
a different provider for three separate roles (agent-loop / text-generation /
critic), and gates any non-Gemini provider behind an eval-verification
checkbox tied to ADR-0030's golden-set pass. Replicating that whole surface
for a web agent that (M10 §2.1) currently drives its whole loop through one
fixed Gemini call would have been a second, much larger project layered on
top of "let me put in my own key" — so this ADR deliberately scopes web BYOK
down, with the user's own explicit sign-off on the smaller shape, while
keeping the underlying storage general enough that a richer UI can layer on
later without a schema change.

## Decision

### Scope: one key, one role, no eval gate (v1)

The web panel (`WebByokKeyPanel.tsx`) is one dropdown (Gemini/Groq/
OpenRouter), one key field, Save-and-test, Delete. No per-role selection, no
eval-verification checkbox. Whichever provider row was saved or updated most
recently is "the" active one — `agent-model` picks it by `updated_at desc`,
not by a separate "active provider" flag, so no extra schema was needed for
this simpler shape. The storage (one row per user+provider, keyed by
provider id) is the SAME shape a richer, role-aware UI would need later —
this ADR narrows the UI, not the data model.

### Where the key lives, and where it never goes

A new `user_provider_keys` table, one row per `(user_id, provider)`:
`encrypted_key` (AES-256-GCM, key derived via SHA-256 from the
`PROVIDER_KEY_SECRET` edge-function secret — never checked in) and `last_four`
(plaintext, display-only — four characters cannot reconstruct a key, so
storing it outside the encrypted column is not a leak).

**The table has no RLS policy for `anon`/`authenticated` at all.** RLS in
Postgres filters ROWS, not COLUMNS — even a correct "owner-only" policy would
still let an authenticated client `SELECT` the `encrypted_key` ciphertext
column directly. The only way this table is reachable at all is a
service-role connection, which every Supabase edge function has and which
bypasses RLS entirely by design. So the real access control is "only
`supabase/functions/byok-keys/index.ts`'s code ever queries this table," not
a policy — and that code is written so **no response, ever, carries the
key** — `save`'s own response is `{hasKey, lastFour}`, identical to `status`.
There is no `get` action.

Testing a key (`test`) sends the plaintext key to our edge function, which
forwards it to the provider and discards it — the one moment the plaintext
exists outside the browser's own memory and the encrypted column. This is a
real, if small, difference from desktop's model (where the key never leaves
the OS keychain except to call the provider directly from the same
process) — the plan's own privacy note already commits to writing this down
plainly rather than hiding it, so `WebByokKeyPanel.tsx`'s description says so
in the same breath as offering the feature.

### CORS was verified NOT to be the reason for a server-side proxy

A live browser check (2026-09-06, `http://localhost:8080` origin) found
`api.groq.com`, `openrouter.ai`, and `generativelanguage.googleapis.com` all
answer a direct browser `fetch` (401/400 — the browser reads the response;
nothing is CORS-blocked). So a browser-direct BYOK call was genuinely
possible. It was rejected anyway, on the user's own explicit instruction:
**the key must be encrypted on our server and never reach the browser at
all**, which a browser-direct call cannot satisfy no matter how the key is
stored client-side (it would have to be decrypted IN the browser to be used
there). This ADR records that CORS was checked and ruled out as the reason,
so a future reader does not "fix" the proxy by removing it.

### The model call is the only thing BYOK ever substitutes

Retrieval — `search_corpus`, `search_shamela`, `islamic-search`'s RAG
pipeline — always stays on the app's own infrastructure, BYOK or not. The
corpus is what makes a citation verifiable; a scholar's own Gemini/Groq/
OpenRouter key has no access to it and was never meant to. `agent-model`
routes only the model-generation call itself; every tool call in
`webDispatch.ts` (M10 §2.1) is unaffected either way.

### A BYOK failure is surfaced, never silently retried on the paid path

If the stored key is rejected by its provider (revoked, rate-limited,
provider outage), `agent-model` returns an error naming the provider and
suggesting the scholar recheck Settings — it does **not** fall back to the
paid gateway. Silently falling back would bill app tokens the scholar
explicitly opted out of by setting up their own key; a scholar who wanted
that mixed behavior can always delete the stored key and let the ordinary
paid path take over.

### No client-supplied `baseUrl` — so no new allowlist surface

Desktop's own outbound allowlist (`electron/lib/agentModelAllowlist.ts`,
now re-exporting `shared/ai/modelAllowlist.ts` — M10 §2.5.1) exists because a
provider spec's `baseUrl` is local configuration a compromised renderer could
in principle tamper with. The web design has no equivalent attack surface:
`agent-model` never accepts a `baseUrl`, `provider`, or any routing hint from
the request body at all — which provider to call is decided entirely from
the caller's own `user_provider_keys` row, looked up server-side by
`user_id` (from the verified JWT), never from anything the client claims.
There is therefore no new fetch target for a client to redirect, and no new
allowlist check was needed on this path — `_shared/providerRegistry.ts`'s
three `baseUrl`s are compile-time constants, not request input.

### Edge functions stay self-contained (a real, unresolved question)

`shared/ai/geminiClient.ts` / `openAiCompatClient.ts` / `modelAllowlist.ts`
(M10 §2.5.1) are pure and would, in principle, work unmodified inside a Deno
edge function. They are **not** imported by `byok-keys` or `agent-model`
regardless: every edge function in this repo is self-contained by
established convention (`tafsir-proxy`'s own header comment: *"no import
from `src/` or `electron/`"*), and no existing function imports across the
`supabase/functions/` boundary into the top-level `shared/` tree either — so
whether Lovable's deploy packaging would even resolve such a path is
untested. Rather than gamble on that against a live function, the small
amount of needed logic (the provider table, the AES-GCM helpers) was
duplicated deliberately into `supabase/functions/_shared/`, with a comment
pointing back to the canonical `shared/` version to keep the two in sync by
hand. If a future session verifies cross-boundary imports work, collapsing
this duplication is a safe, mechanical follow-up — not a design change.

## Consequences

**Positive**
- A scholar with a free Groq/Gemini/OpenRouter tier can run the web agent at
  zero token cost, the same saving desktop already had.
- The key is never a browser-side secret at any point after saving — a
  compromised web session (XSS, a malicious extension) cannot exfiltrate it,
  which is a strictly better position than "encrypted in browser storage."
- The storage shape does not block a later richer UI (per-role selection,
  eval-gated non-Gemini providers matching desktop) — that is a UI and
  routing change, not a migration.

**Negative**
- Unlike desktop, the plaintext key does cross our own server at `save`/
  `test` time (never stored, never logged — but the trust model is "we
  don't," not "it's structurally impossible," the way desktop's local-only
  flow is). Documented plainly in the panel's own description, not hidden.
- No per-role selection means a scholar cannot, in this v1, use one
  provider for the agent loop and a different (perhaps stronger) one for
  drafting prose — whichever key was saved most recently drives every call.
- No eval-verification gate means a web BYOK provider is not held to the
  same "cleared the golden-set eval" bar ADR-0030 requires before desktop
  lets a non-Gemini provider drive the loop. Given the web agent's own loop
  is new this milestone and already Gemini-only by default, this is a
  smaller gap than it would be against a mature multi-provider desktop loop
  — but a real one, worth closing if usage shows non-Gemini web providers
  producing weaker tool-calling.

## Follow-ups

- 2.5.4 (deferred, not part of this ADR's scope): Groq's Whisper endpoint and
  Gemini's TTS as free-tier alternatives to the paid `transcribe`/TTS edge
  functions — needs live testing against a real key and real Urdu/Arabic
  audio before promising anything, which needs the user's own credentials.
- `PROVIDER_KEY_SECRET` still needs setting in Lovable's edge-function
  secrets (save 500s with a clear message until then), and this ADR's
  migration (`20260908000000_user_provider_keys.sql`) still needs applying
  through Lovable's own migration path — both the user's to do, not
  something pushed live from this session.
- Collapse `supabase/functions/_shared/providerRegistry.ts` /
  `providerKeyCrypto.ts` into imports of the canonical `shared/ai/*` modules,
  if a future session verifies cross-`supabase/functions/`-boundary imports
  survive Lovable's deploy packaging.
- A UI affordance saying "this answer used your own key — no tokens spent"
  was scoped out of this pass (would need `parseModelStep`'s `ModelStep`
  contract to carry an extra flag through both platforms) — worth adding
  once the simpler v1 has real usage.
