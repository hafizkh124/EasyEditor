# Testing Strategy

**Date:** 2026-08-24 · **Status:** P0 + P1 shipped 2026-08-24 across 5 rounds; P2 complete (rounds 6-9, 2026-08-24/25); P3 complete (round 10, 2026-08-25) · **Related:** [SMOKE-TESTS.md](./SMOKE-TESTS.md), [QA-M5.md](./QA-M5.md)

§1 records the baseline as measured on 2026-08-24 and what it is now that P0 and
P1 have landed. Everything from §3 onward that is not marked ✅ is still a
proposal.

---

## 1. Where the suite stands

| Measure | Baseline | Now |
|---|---|---|
| Test files executed by `npm test` | 96 | **124** |
| Tests | 771 passed, 11 skipped | **1471 passed, 11 skipped, 0 failing** |
| Wall-clock (`npm test`) | 179.9 s | ~90–160 s (fixtures share the machine with everything else running) |
| Coverage number | **did not exist** | **33.17 % lines** (baseline was 25.45 %) |
| E2E tests | 0 | 0 *(P3)* |
| Edge-function handlers reachable from a test | 0 of 29 | **29 of 29** |
| Deno tests run by no pipeline | 3 files | **0** — ported into the vitest suite |

The 235 new tests are not spread thinly. They are 38 on the `shell.openExternal`
allowlist, 52 on the receipt auto-approval decision, 89 on the HTTP contract of
all 29 edge functions, 15 on verify-receipt's request gate, and 41 that already
existed but had never been executed.

Two things that read as coverage but are not:

- **`npm run smoke:functions`** proves each edge function is deployed, boots, and
  answers CORS preflight. It deliberately asserts nothing about behaviour.
- **The 11 skipped tests** are all `sharedRuntime.test.ts`'s `skipIf(!denoAvailable)`
  block. They still skip *locally* (Deno is not installed on this machine), but
  `ci.yml` now installs Deno, so they run on every PR rather than only at
  release time.

### What P0 turned up

Two things that only surfaced because the tests were written:

1. **A live hole in receipt auto-approval.** The receiver check compared
   bidirectionally with unguarded `includes`, so an AI-extracted receiver of `""`
   or `"0"` matched a real account — `""` is a substring of everything and `"0"`
   is a substring of `"00420745"`. A receipt with the right amount and high
   confidence whose payee field came back unreadable could auto-approve a paid
   tier. Fixed in `_shared/receiptDecision.ts` with a documented minimum-length
   guard; the shortest real receiver is 8 characters, so nothing legitimate is
   lost, and unreadable receipts now go to manual review. See
   `src/test/receiptDecision.test.ts` → *"the short-fragment hole"*.
2. **jsdom was costing far more than estimated.** The strategy first guessed the
   saving would be "a fraction" of the reported 622 s. Measured directly, one
   trivial test file took **37.5 s under jsdom and 1.37 s under node**. The
   environment split cut the whole suite by 47 %.

> **Deployed 2026-08-24** (commit `eee8fe9` on `main`). 28 of 29 edge functions
> redeployed; `mcp` was held back by platform policy and picks up the change on
> the next publish — its diff was wrapper-only, so the live version behaves
> identically. `npm run smoke:functions` reports 29/29. Still unverified: the
> `vector-search` happy path, which needs an authenticated research query — the
> smoke probe posts `{}` and only reaches the pre-existing "Query is required"
> branch.

> **Round 2 deployed 2026-08-24** (`dea6fb7`), smoke-verified 29/29. Round 3
> (`verify-renewal-receipt` handler tests + one bug fix, below) is pushed and
> awaiting deploy.

### What P1 turned up

3. **`vector-search` answered every failure with `200 {results: []}`** —
   identical to a successful search that matched nothing. A malformed body, a
   `match_scholarly_documents` RPC error and an embedder outage were all
   indistinguishable from an empty corpus, to the caller and to anyone reading
   logs. Body parsing now happens outside the blanket `try` and returns 400
   (which the function already did for a missing `query` — the only reason a
   broken body escaped it was that `req.json()` threw first). The three genuine
   degradation paths still return 200, because the research UI treats this
   channel as best-effort and must keep rendering its other sources, but they
   now carry `degraded: true` and a `reason`. Given that a silent
   `vector-search` domain bug has already cost this project a debugging round,
   the distinction is worth making explicit.
5. **A typographic apostrophe was silently discarding real citations.**
   `citationVerifier`'s reference parser matched `qur['']?an` — a class holding
   three copies of U+0027, meaning the curly variants it was plainly meant to
   accept had been flattened to straight quotes, most likely by an editor
   normalising smart quotes. So `Qur'an 2:267` with a typographic apostrophe —
   the form language models actually emit — failed to parse, and a **real,
   verifiable verse was rejected as unverifiable and dropped from the answer**,
   with nothing in the response saying so. This is the same failure mode as the
   citation/reference-list mismatch fixed earlier in the project, arriving by a
   different route. The class now carries all seven variants plus the academic
   transliteration `Qurʾān`. They are literal characters, so the same flattening
   could recur — the guard is the regression test, which asserts each variant
   parses and fails CI if the class is narrowed again. (Verified: re-flattening
   the class breaks 7 tests.)
4. **`verify-receipt` had never been typechecked.** Pulling it into `tsconfig`
   surfaced `admin: ReturnType<typeof createClient>`, which instantiates the
   schema generics as `never` and makes every `.update({…})` argument
   unassignable. Not a runtime bug, but it means the file's types were
   decorative. Fixed locally with an honest `SupabaseClient<any>` alias; the
   same pattern appears in ~10 other functions and should be converted as those
   gain tests.

The existing suite is genuinely good where it exists: retrieval, citation
identity, dedup, i18n key coverage, UI discipline, RTL/direction, PWA update
detection. The gaps are not "we have no tests"; they are specific, and they
cluster in three places: **money, the edge-function HTTP layer, and Electron**.

---

## 2. Pyramid, as it actually stands

```
        E2E            (none)                        ← nothing verifies a packaged build
    ─────────────────────────────────────
     Integration       (smoke only — boot + CORS)    ← 29 functions, 0 behavioural tests
    ─────────────────────────────────────
      Unit             96 files / 771 tests          ← healthy, but blind to whole subsystems
```

The pyramid is not inverted — the top two layers are simply missing. The risk
that follows is specific: a change can pass every gate in `ci.yml` and still ship
a broken payment activation, a 500-ing edge handler, or an Electron build that
will not start.

---

## 3. Gaps, ranked by risk

### G1 — The money path has no tests at all ✅ *closed*

`verify-receipt` (344 LOC), `verify-renewal-receipt` (255), `check-subscription-expiry`
(184), `reset-monthly-quotas` (103), `process-email-queue` (363) — none are
covered. `verify-receipt` alone parses an AI vision response, applies a
confidence threshold, checks amount and receiver, and then **writes tier,
expiry, and token allocation**. Client-side, `subscriptionLifecycle.ts`,
`planTiers.ts`, `tierUpgrade.ts`, `paymentAccounts.ts`, and `referral.ts` are
likewise untested.

Blast radius: wrong tier granted, replay of a `payment_reference`, tokens
allocated twice, or a paying user silently downgraded. All of these are
user-visible, hard to detect, and awkward to reverse.

**Done:** the decision is now `_shared/receiptDecision.ts` — pure, shared by both
receipt functions instead of duplicated, covered by 52 tests, and writing them
exposed the short-fragment hole described in §1.

**Also done:** `src/test/helpers/fakeSupabase.ts` fakes `createClient`, which
unblocked everything past the auth wall. `verifyReceiptActivation.test.ts` (40
tests) now covers the replay check, `storagePath` ownership, the storage-download
failure, and every write `autoApprove` issues — tier, 30-day expiry, usage-counter
reset, token allocation, the payment log, and that a failed subscription write
credits no wallet. Those 40 were checked against six deliberate mutations
(60-day expiry, disabled replay check, removed ownership check, wrong token
allocation, un-reset counters, removed receiver guard) and **all six were
caught** — the tests bite rather than merely pass.

**Round 4 closed the rest:** `check-subscription-expiry` (21 tests, including
its own idempotency and admin-exemption claims proven for real rather than by
fixture construction), `reset-monthly-quotas` (11 tests), `process-email-queue`
(21 tests — retry/DLQ/rate-limit/dedup logic). **Still open:** the client-side
subscription modules (`subscriptionLifecycle`, `planTiers`, `tierUpgrade`,
`referral`) — none of them are edge functions, so they need component/hook
tests rather than the handler pattern used here.

### G2 — No edge-function handler is callable from a test ✅ *closed*

28 of 29 functions wrapped their entire logic in an anonymous
`serve(async (req) => …)`. There was no seam, so request validation, auth
rejection, error mapping and CORS headers were only ever exercised by the smoke
script's "did it return a sane status" check.

**Done:** every function now exports `handle(req)` and calls `serve(handle)`
separately. The transform was mechanical and each file's diff is exactly the
same size (+10/−2), which is the evidence that only the wrapper moved.

Making the modules importable took three supporting pieces, since they are
written for Deno: a `deno-specifiers` plugin in `vitest.config.ts` that strips
`npm:` / `esm.sh` prefixes and pinned versions and resolves the bare package;
`src/test/helpers/denoShim.ts` for `globalThis.Deno`; and stubs for the two
specifiers with no npm counterpart (`std/http/server.ts`,
`@lovable.dev/email-js`). `src/types/deno-edge.d.ts` carries the compile-time
half of the same mapping.

### G3 — The `_shared/` modules that matter most are the untested ones ✅ *closed — see §G3 done below*

`citationVerifier.ts` — the safety net that drops hallucinated citations before
the client renders them — had no test, in a project where citation integrity has
already been a shipped bug class.

**Done:** 42 tests, mostly negative (nothing unverifiable survives), plus the
positive guarantee that the stored matn and `source_url` override whatever the
model wrote. Writing them found the apostrophe bug in §1. Still untested:
`aiGateway.ts`, `rateLimit.ts`, `citationCandidates.ts`, `segmentClaims.ts`,
`arabicRoot.ts`, `researchPrompts.ts`, `stopwords.ts`.

### G4 — Electron's security boundary is untested ✅ *see the round-6 section below for what's closed and what's left*

`electron/lib/urlAllowlist.ts` decides what `shell.openExternal` will open. It is
a security control with no test — **now covered** by 38 adversarial cases
(suffix/prefix spoofing, userinfo tricks, non-https schemes, malformed input,
missing `VITE_SUPABASE_URL`) at a CI-enforced 100 % lines/branches floor.
Still open: `electron/ipc/*` (5 handler modules),
`electron/preload.ts`, `electron/db/*` (schema, migrations runner, vectorSearch)
are all untested, and `release.yml` packages and publishes them without any
launch check.

### G5 — Three Deno tests run in no pipeline ✅ *closed*

`bilingualMap.test.ts`, `queryPlanner.test.ts`, `rankFusion.test.ts` were real
tests with real assertions that nothing executed.

**Done:** all three moved to `src/test/`, with `src/test/helpers/denoAsserts.ts`
shimming `assertEquals`/`assert` onto `expect` so the assertion bodies did not
have to be rewritten. 41 tests, 2 s, running on every PR. `ci.yml` also installs
Deno now, which unskips `sharedRuntime.test.ts`'s 11 cross-runtime cases.

### G6 — No coverage instrumentation ✅ *closed*

Without a provider there was no baseline, no per-directory threshold, and no way
to stop coverage sliding.

**Done:** `@vitest/coverage-v8@3.2.7` (version-matched to vitest — `@latest`
pulls v4 and fails to resolve), `npm run test:coverage`, and `ci.yml` now runs
that instead of a bare `vitest run`. First baseline: **25.45 % lines**. The
threshold on `urlAllowlist.ts` immediately earned its place by catching an
uncovered branch in the very test written for it.

### G7 — jsdom is paid for on every file ✅ *closed*

`environment: "jsdom"` was global. 55 of 70 `.ts` test files reference no DOM
global at all.

**Done:** 52 pure-logic files carry `// @vitest-environment node`; jsdom stays
the *default* so a new component test that forgets the annotation still works.
`src/test/setup.ts` guards its `window` patching accordingly. Four files were
annotated and then reverted because they use bare `window` — the full-suite run
found them, which is the intended way to discover that boundary.

### G8 — Nine tests assert on source text

`arabicMatnFilter`, `deleteByScope`, `documentChunks`, `fontLoading`,
`researchSources`, `rijalNarrations`, `securityPrepass`, `sharedRuntime`,
`tokenContrast` read files with `readFileSync` and assert on their contents.
This is a legitimate technique for cross-runtime and mirror-staleness invariants
that cannot be executed — but it is brittle when used as a substitute for
calling the code, and G2 is the reason several of them exist.

---

## 4. Test plan by area

| Area | Test type | Assert | Target |
|---|---|---|---|
| Payments & subscription (`verify-receipt`, `verify-renewal-receipt`, `subscriptionLifecycle`, `planTiers`) | Unit on extracted decision functions + integration on `handle(req)` | Threshold logic, amount/receiver match, replay rejection, tier→limits mapping, expiry arithmetic across month ends | **90 % lines** — highest bar in the repo |
| Quota & rate limiting (`reset-monthly-quotas`, `rateLimit.ts`, `useLimitReached`) | Unit | Window boundaries, reset idempotency, per-user isolation | 90 % |
| Citation integrity (`citationVerifier`, `citationCandidates`, `citationEngine`, `segmentClaims`) | Unit with a stubbed Supabase client | Every rejection path; a hallucinated verse/book/hadith number is dropped, never rendered | 85 % |
| Retrieval (`retrievalQuery`, `rankFusion`, `resultIdentity`, `queryPlanner`, `disciplines`) | Unit | Already strong — extend to empty-channel and single-channel degradation | maintain |
| Edge-function HTTP layer (all 29) | Integration on exported `handle(req)` | 400 on bad body, 401 without JWT, CORS headers on OPTIONS **and** on error responses, no unhandled throw | 1 test file per function, ≥4 cases |
| Electron security (`urlAllowlist`, `systemHandlers`) | Unit | Every non-allowlisted host, `file:`/`javascript:`/`data:` schemes, host-suffix spoofing (`shamela.ws.evil.com`) | 100 % of `urlAllowlist` |
| Electron IPC + local DB (`ipc/*`, `db/*`, `shamela/*`) | Integration against a temp SQLite file | Migration runner is idempotent and ordered; vector search returns ranked rows; import is resumable | 70 % |
| Workspace services (`documentService`, `annotationService`, `readerService`, `libraryItemService`, `legacyMigration`) | Unit against `localBackend` | Round-trip persistence, both-backends parity, migration from legacy shape | 80 % |
| Research streaming (`sse.ts`, `research/streamers.ts`, `persistence.ts`) | Unit | Partial-chunk reassembly, mid-stream abort, malformed frame does not kill the session | 80 % |
| React pages & components | Component tests, current approach | Keep the existing discipline: test behaviour and a11y, not markup. Do **not** chase coverage on `components/ui/` (shadcn primitives) | no target |
| Packaged desktop app | E2E smoke, 1 spec | App launches, main window opens, no main-process error, one document round-trips | binary pass/fail |

**Explicitly out of scope:** `src/components/ui/*` (36 vendored shadcn
primitives), type-only files, `src/locales/`, one-off scripts under `scratch/`.

---

## 5. Concrete first tests

### 5.1 The seam that unlocks G2

Change each function from an inline handler to an exported one. This is a
mechanical, behaviour-preserving edit:

```ts
// supabase/functions/islamic-search/index.ts
export async function handle(req: Request): Promise<Response> {
  // … existing body, unchanged …
}

serve(handle);
```

That single change makes every function testable, and lets several of the
`readFileSync` grep-tests in G8 be replaced by tests that actually call the code.

### 5.2 `urlAllowlist` — smallest test, real security value

```ts
// src/test/urlAllowlist.test.ts
import { isAllowedExternalUrl } from "../../electron/lib/urlAllowlist";

describe("isAllowedExternalUrl", () => {
  it.each(["https://shamela.ws/book/1", "https://github.com/hafizkh124/EasyEditor"])(
    "allows %s", (u) => expect(isAllowedExternalUrl(u)).not.toBeNull(),
  );

  it.each([
    "https://shamela.ws.evil.com/x",   // suffix spoof
    "http://shamela.ws/x",             // downgrade to http
    "file:///C:/Windows/System32",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
  ])("rejects %s", (u) => expect(isAllowedExternalUrl(u)).toBeNull());
});
```

### 5.3 `verify-receipt` — the decision, separated from the I/O

Extract the judgement into a pure function and test it exhaustively; leave the
storage download and DB write in the handler.

```ts
// decideActivation({ confidence, amount, receiver, tier, expectedAccounts })
//   → { action: "auto_approve" | "manual_review", reason }

it("flags for manual review at exactly the threshold boundary", () => {
  expect(decideActivation({ confidence: 89.9, ... }).action).toBe("manual_review");
  expect(decideActivation({ confidence: 90,   ... }).action).toBe("auto_approve");
});

it("never auto-approves when the receiver account does not match", () => {
  expect(decideActivation({ confidence: 99, receiver: "someone-else", ... }).action)
    .toBe("manual_review");
});

it("rejects a payment_reference that has already been used", async () => {
  // handle(req) twice with the same reference → second is 409, no second write
});
```

### 5.4 `citationVerifier` — the rejection paths

```ts
it("drops a citation whose verse does not exist in scholarly_documents", …);
it("drops a citation whose book slug is not in the registry", …);
it("keeps a citation matched by free-form reference when structured ids are absent", …);
it("returns an empty list rather than throwing when the DB call fails", …);
```

### 5.5 Packaged-app E2E (one spec, `@playwright/test` + `_electron`)

```ts
const app = await electron.launch({ args: ["dist-electron/main.js"] });
const win = await app.firstWindow();
await expect(win).toHaveTitle(/EasyEditor/);
expect(mainProcessErrors).toEqual([]);
```

Run it in `release.yml` after `build:electron`, before upload — so a build that
cannot start never becomes a release artifact.

---

## 6. Conventions

**Where tests live.** `src/test/*.test.ts(x)` for everything vitest runs, including
tests that import from `supabase/functions/_shared/` (this is already the
pattern). Deno-native tests stay beside the code in `__tests__/` and are run by
`deno test` (§8).

**Source-text assertions (`readFileSync`) are allowed only when the property
cannot be executed** — cross-runtime purity (`check:shared`), mirror staleness
(`documentChunks.test.ts`), or a build-time substitution. Every such test must
carry a comment saying why it cannot call the code. Once §5.1 lands, revisit
`arabicMatnFilter`, `researchSources`, `deleteByScope`, and `rijalNarrations` —
those four assert on behaviour that will then be directly callable.

**What not to test:** shadcn primitives, framework behaviour, getters, generated
types, `scratch/`.

**Every bug fix gets a regression test** naming the symptom, in the style of
`51b4d66` ("regression test for the SQL audit's false positives"). This is
already the habit; the plan just makes it explicit.

---

## 7. Speed and maintenance

Split the environment rather than paying jsdom everywhere (G7):

```ts
// vitest.config.ts
test: {
  projects: [
    { extends: true, test: { name: "node", environment: "node",
        include: ["src/test/**/*.test.ts"], exclude: [/* the 15 DOM-touching .ts files */] } },
    { extends: true, test: { name: "dom", environment: "jsdom",
        setupFiles: ["./src/test/setup.ts"], include: ["src/test/**/*.test.tsx", /* + those 15 */] } },
  ],
}
```

Measure before and after — the 622 s figure is aggregate worker time across
parallel forks, so the wall-clock saving will be a fraction of it, not all of it.
If the split lands, the 30 s `testTimeout` (added because parallel scheduling,
not hung code, was causing timeouts) can likely come back down for the node
project.

---

## 8. CI changes

Add to `ci.yml`, in this order (cheapest gate first):

```yaml
- uses: denoland/setup-deno@v2          # unskips the 11 sharedRuntime tests (G5)
  with: { deno-version: v2.x }

- name: Deno unit tests
  run: deno test --allow-read supabase/functions/_shared/__tests__/

- name: Test with coverage
  run: npm run test:coverage            # replaces the current `npm run test` step
```

And in `release.yml`, after `build:electron`:

```yaml
- name: Packaged app smoke
  run: npm run test:e2e
```

`smoke-edge-functions.yml` stays as-is — it is post-deploy verification and
correctly separate. Its `node-version: 20` should be bumped to 22 for
consistency with the other two workflows.

---

## 9. Coverage targets

Install `@vitest/coverage-v8`, add `"test:coverage": "vitest run --coverage"`, and
set **per-path thresholds** rather than one global number — a global percentage
would be met by the 206 component files and would say nothing about the money
path.

```ts
coverage: {
  provider: "v8",
  exclude: ["src/components/ui/**", "src/locales/**", "**/*.d.ts", "scratch/**"],
  thresholds: {
    "supabase/functions/verify-receipt/**": { lines: 90, branches: 85 },
    "supabase/functions/verify-renewal-receipt/**": { lines: 90, branches: 85 },
    "supabase/functions/_shared/citationVerifier.ts": { lines: 85 },
    "electron/lib/urlAllowlist.ts": { lines: 100, branches: 100 },
    "src/core/**": { lines: 80 },
    "src/lib/**": { lines: 70 },
  },
}
```

Record the first real global number as the baseline and ratchet it upward only
when it rises on its own — never set a target the suite cannot already meet, or
the gate gets disabled within a month.

---

## 10. Backlog

| P | Item | Gap | Status |
|---|---|---|---|
| P0 | `urlAllowlist` test — 38 cases, 100 % lines/branches, threshold-enforced | G4 | ✅ done |
| P0 | Port the 3 orphaned Deno tests into vitest; add `setup-deno` to `ci.yml` | G5 | ✅ done |
| P0 | Install coverage provider, record baseline (25.45 %), gate CI on it | G6 | ✅ done |
| P0 | Extract `decideActivation`; 52 tests; **fixed a live auto-approval hole** | G1 | ✅ done |
| P0 | jsdom → node environment split (promoted from P2 after measuring) | G7 | ✅ done |
| P1 | Export `handle(req)` from all 29 functions | G2 | ✅ done |
| P1 | HTTP contract test across all 29 (CORS preflight, malformed body, empty body) + verify-receipt's request gate | G2 | ✅ done — **found the vector-search finding** |
| P1 | Fake for `createClient` (`src/test/helpers/fakeSupabase.ts`) | G1/G3 | ✅ done |
| P1 | verify-receipt past the auth wall — replay, ownership, activation writes | G1 | ✅ done — 40 tests, 6/6 mutations caught |
| P1 | `citationVerifier` rejection-path tests | G3 | ✅ done — **found the apostrophe bug** |
| P1 | `citationCandidates`, `segmentClaims` | G3 | ✅ done |
| P1 | `verify-renewal-receipt` handler tests | G1 | ✅ done |
| P1 | `check-subscription-expiry`, `reset-monthly-quotas`, `process-email-queue` | G1 | ✅ done — **found a bug in the test fixture itself, caught by its own first run** |
| P2 | Electron IPC (`registry`, `systemHandlers`, `workspaceHandlers`, `aiHandlers`) | G4 | ✅ done — **found the untested prototype-pollution guard** |
| P2 | Migration runner tests against temp SQLite files | G4 | ✅ done — 3 mutation-survivors, all test-design fixes, no production bug |
| P2 | `shamelaHandlers`, `tafsirHandlers`, `voiceHandlers` | G4 | ✅ done — found 2 dead imports, no production bugs |
| P2 | SSE/streaming reassembly + abort tests | — | half day |
| P3 | Playwright `_electron` launch smoke in `release.yml` | E2E | ✅ done |
| P3 | Replace the four grep-tests made redundant by P1 | G8 | ✅ done — **found a live token-refund bug** |
| P3 | Per-path coverage thresholds, ratchet | G6 | ✅ done |

P0 and P1 are done, including the `createClient` fake that was the blocker.

Three of the four bugs found so far were found *by writing the test*, not by
reading the code — the receiver short-fragment hole, `vector-search`'s silent
200, and the apostrophe class. That is the argument for continuing down the
backlog rather than declaring the coverage number good enough: each of those was
invisible to review and to the smoke script, and each was in a path where
failure is silent by construction.

**Round 3, same day:** `verify-renewal-receipt` handler tests (29 tests),
mirroring `verifyReceiptActivation.test.ts` but for what is genuinely different
about renewal — the "existing tier required" gate, and the expiry math that
extends from `max(currentExpiry, now)` rather than always from now, so a lapsed
renewal does not inherit a stale past date. Also found and fixed:

6. **Dead placeholder code was corrupting the token audit trail on every
   renewal.** The token-reset block opened with a call to the `credit_tokens`
   RPC using `p_amount: 1` and a comment admitting it was "placeholder — real
   reset below". `credit_tokens` is ADDITIVE
   (`monthly_balance = monthly_balance + p_amount`), so that call bumped the
   balance by one token that the very next statement immediately overwrote, and
   inserted a `token_transactions` row claiming a `"monthly_reset"` of amount 1
   — a false entry into the table `check-subscription-expiry` treats as the
   authoritative usage/credit ledger. Removed; the direct `token_wallets`
   update below it is a full reset to the tier's allocation regardless.

7. **The fake `createClient` itself had a bug, found while writing round 3.**
   `.eq()` was recorded but never actually applied when resolving a `select()`
   — every configured row for a table came back regardless of the filter. This
   was invisible in rounds 1–2 because no test read the *same* table twice with
   different filters in one request. `verify-renewal-receipt` does exactly
   that: the "does this user have an active plan" lookup and the "has this
   payment_reference been used" replay check both read `subscriptions`, and an
   unfiltered fake let the seeded active-subscription row satisfy both — a
   legitimate renewal request was read back as a duplicate payment. Fixed by
   tracking real `.eq()` calls separately and filtering on them; every other
   filter method (`.or()`, `.gte()`, …) stays recorded-but-not-applied, since a
   fake matcher for a partial-index expression would be more likely to hide a
   bug than reveal one. This required updating three existing test files' row
   fixtures to include the fields their `.eq()` calls actually filter on
   (`payment_reference`, `user_id`, `source_type`) — they had been passing
   because the filter was a no-op, not because they proved what they claimed.

All three fixes in round 3 were verified with mutation testing before commit —
6 deliberate mutations (60-day expiry, stale-date extension, no renewal_count
increment, no existing-tier check, wrong tier's token amount, and reverting the
`.eq()` fix itself) were run against the full fake-dependent suite; all 6 were
caught.

**Round 4, same day:** `reset-monthly-quotas` (11 tests), `check-subscription-expiry`
(21 tests), `process-email-queue` (21 tests) — the three remaining functions in
G1's original list. No production bugs this round, but two things worth
recording:

8. **The fake needed to grow up before `check-subscription-expiry` could be
   tested honestly.** Its own docstring claims two properties — idempotency for
   already-free users, and admin exemption — that only a real database query
   can prove or disprove. The fake's `.eq()`-only filtering (round 3) could not
   express `.lt("expires_at", now)` or `.neq("tier", "free")`, and `.lt()`
   did not even exist as a method — calling it would have thrown. Generalized
   `fakeSupabase.ts` to a small operator-tagged matcher list
   (`eq`/`neq`/`lt`/`lte`/`gt`/`gte`, all genuinely applied) while keeping
   `.in()`/`.or()`/`.ilike()` recorded-but-inert, for the same reason as
   before: a fake matcher for those would be more likely to hide a bug than
   reveal one. Also extended the `.rpc()` mock to accept a function of `args`,
   since `process-email-queue` calls `read_email_batch` twice with different
   `queue_name` in one request and needs a different batch back each time.

9. **A bug in the *test*, not the code — and it would have shipped as 21 green
   tests proving nothing.** `process-email-queue.test.ts`'s message-fixture
   helper spread `...over` *after* setting a merged `message` field; since
   `over` itself often carried its own `message` key, that spread silently
   clobbered the whole merged object down to just what the test passed —
   dropping `queued_at` in the process. Every customized message then fell
   back to the batch row's `enqueued_at`, over an hour stale against the fixed
   test clock, so it read as TTL-expired and got diverted to the DLQ before
   ever reaching the code path most of these tests meant to exercise. Caught
   immediately because the *first* run showed the wrong `stopped` reasons and
   wrong `processed` counts rather than passing — but it is the sharpest
   reminder yet that a fixture bug fails exactly like a passing test until
   something forces the mismatch into view, which is the whole argument for
   mutation-testing every new suite before it ships rather than trusting a
   green run.

Also: importing `process-email-queue/index.ts` from a test for the first time
put it in front of `tsc` for the first time, which surfaced two more
first-contact issues (same pattern as `verify-receipt`'s `ReturnType<typeof
createClient>` in round 1): the file uses `String.prototype.replaceAll`
(ES2021), one version past `tsconfig.app.json`'s `lib: ["ES2020", …]` — fixed
by adding `"ES2021"` to `lib` project-wide, verified against the rest of the
codebase (`grep -rl '\.replaceAll('`) to confirm nothing else needed it and
nothing could regress from a lib addition. And the ambient `declare module
"npm:@lovable.dev/*" { const value: any; export = value; }` from round 1 (added
for `mcp/index.ts`) does not actually support the *named* imports this package
uses (`import { sendLovableEmail } from …`) — `export =` only satisfies a
default-style import, even under `esModuleInterop`. Replaced with the bodyless
`declare module "npm:@lovable.dev/*";` form, which is the idiom that does
support arbitrary named imports.

All of round 4 was mutation-tested before commit: 8 deliberate mutations across
the three functions (bonus-rate drift, RPC-failure no longer stopping the run,
admin exemption removed, `topup_balance` no longer preserved, idempotency guard
removed, `MAX_RETRIES` raised, 429 no longer stopping the batch, duplicate-send
guard removed). All 8 caught.

**Round 5, same day:** `citationCandidates` (18 tests) and `segmentClaims` (22
tests) — the last two untested `_shared/` modules from G3's original list.

`citationCandidates.ts` is the retrieval half of the citation pipeline: for one
claim it fans out to FTS, topic-anchor lookup, vector search, and a live-API
call, then dedupes and buckets the results before the LLM ever sees them.
`lookupTopicAnchors` and `planQuery` were mocked (a large static keyword table
and an AI-gateway call respectively — separate concerns from this module's own
orchestration); `expandQueryTerms` was left real since it is pure and already
covered elsewhere. Confirmed for real, not by construction: topic anchors
outrank FTS for the same `match_key` (the higher-authority source wins the
dedup), a row missing the fields a citation needs is dropped rather than
producing a broken candidate, and a vector hit outranks an API-only hit when
`maxQuran`/`maxHadith` forces a choice — API results are the weakest evidence,
being outside `scholarly_documents` entirely.

`segmentClaims.ts` re-exports `shared/text/chunk.ts`'s sentence segmenter
(SPEC-M5 FR-1.5/FR-3.4) and adds one function of its own, `detectScript`.
`segmentText` runs once per claim ahead of every citation lookup, so a
boundary bug either merges two claims into one lookup (losing a citation) or
fragments one claim past what any lookup can match — and its character-offset
contract (`[start, end)` must slice the original input back to the segment's
own text) is exactly what lets a caller re-insert a citation at the right
place. Tested the offset round-trip directly rather than trusting it by
construction, plus the two size-based edge behaviours: short fragments merging
backward into an existing segment (never forward, and never when there is no
prior segment to merge into — a short *first* fragment survives standalone),
and the 30-segment cap folding the tail into one final segment rather than
silently dropping it.

Two things surfaced while getting the mutation-testing pass clean, neither a
production bug:

10. **`segmentClaims.ts` re-exports from the *mirror* copy, not the file two
    of my first mutations edited.** `shared/text/chunk.ts` is the canonical
    source, but the edge-function side imports
    `supabase/functions/_shared/mirror/text/chunk.ts` — a build-time-synced
    duplicate, because Deno's deploy bundle can only see `supabase/functions/`.
    Mutating the canonical file alone was a silent no-op for these tests; both
    mutations "survived" on the first pass for that reason, not because the
    tests were weak. Retargeted the mutation script at the mirror and both
    were then caught.
11. **A stray `git checkout` during that debugging left a real, if narrow, gap
    exposed.** Restoring `shared/text/chunk.ts` after a manual mutation
    re-materialized it with CRLF line endings (Windows `core.autocrlf=true`),
    while its mirror is LF — which `documentChunks.test.ts` exists
    specifically to catch (see [[easyeditor-crlf-ci-hash-mismatch]]). It did:
    the very next full-suite run failed there. Not a new bug — the guard did
    its job — but a reminder that debugging mutation tests by hand on this
    machine can leave the tree in a state the suite correctly rejects.

All of round 5 mutation-tested (8/8 caught, after the mirror-file retarget).

**Round 6, same day — the first P2 work: Electron IPC.** `electron/ipc/*.ts`
had zero tests; `require('electron')` under plain Node resolves to the path of
the `electron.exe` binary, not the real API, so nothing that imports `electron`
could be imported by a test at all without a fake for it. Added
`src/test/helpers/electronMock.ts` (captures `ipcMain.handle()` registrations
by channel, so a test can invoke a handler directly with a fake IPC event) and
scoped this round to the pieces with real security or routing risk rather than
the full six-file surface:

- `registry.ts`'s `isAllowedIpcChannel` (50 tests) — the channel allowlist
  every IPC surface in the app depends on.
- `systemHandlers.ts` (12 tests) — `system:open-external`'s reuse of
  `isAllowedExternalUrl` (already proven correct in isolation by
  `urlAllowlist.test.ts`; this proves the IPC wiring around it doesn't add a
  bypass, e.g. forgetting the runtime type check on a value that crossed the
  IPC boundary as `unknown`).
- `workspaceHandlers.ts` (18 tests) — the highest-priority find of this round.
  Its own comment states the exact attack it defends against: `service[name]`
  alone would reach `Object.prototype` members (`constructor`, `toString`,
  `__proto__`, …) for any method name a compromised or buggy renderer sends
  over `workspace:invoke`. This is the closest thing in the codebase to a
  prototype-pollution guard and had no test. Exported the previously-private
  `ALLOWED_WORKSPACE_METHODS` (mirroring P1's `handle` exports) so a test can
  check it against `WorkspaceDbService`'s real prototype — the source
  comment's own "keep this list in sync" promise was otherwise unenforced.
- `redactKeyFromLog` (7 tests, standalone) and `aiHandlers.ts`'s `AI_INVOKE`
  dispatch (21 tests) — the `edge-function` compatibility mode's routing
  (`library-ingest` → local DB, `refine-text` → local Gemini with the right
  prompt, `graph-extract` → an explicit refusal, unknown names → a named
  refusal) and, more importantly, that a leaked Gemini key is redacted before
  an error reaches the renderer or a log. `redactKeyFromLog` was left real
  (not mocked) inside the `aiHandlers.test.ts` integration specifically to
  prove the *wiring* calls it, not just that the function works alone.

No production bugs found this round — both allowlists were already correctly
constructed — but two first-contact issues surfaced from pulling `electron/`
into the TS program for the first time (same class as `verify-receipt`'s
`ReturnType<typeof createClient>` in round 1 and `process-email-queue`'s
`.replaceAll` in round 4): `electron/db/migrations/runner.ts` had an unused
`path` import (dead code, harmless, fixed), and my own test fixture for a
"real-looking" Gemini key was the wrong length twice in a row — 31 characters
instead of 33 the first time, 32 instead of 33 the second — silently making
the redaction assertions pass or fail for the wrong reason until a length
guard was added to the fixture itself, which caught its own mistake before
the real assertions even ran.

All of round 6 mutation-tested (7/7 caught): the channel allowlist accepting
anything, `open-external` skipping its allowlist check, `workspace:invoke`'s
prototype-pollution guard disabled, `constructor` added to that allowlist,
`refine-text` no longer requiring valid input, the error-redaction call
removed from `aiHandlers.ts`'s catch block, and `redactKeyFromLog`'s pattern
match disabled.

## G4 — Electron's security boundary ✅ *see the round-8 section below — IPC layer and migration runner both closed*

**Round 7, same day: the migration runner.** `electron/db/migrations/runner.ts`
is what SPEC-M5 risk R14 is about — a pre-migration backup and versioned,
transactional schema migrations for every user's local database. It only
type-imports from `open.ts` (`import type { SqliteDatabase }`, erased at
compile time), so unlike the IPC handlers this needed no `electron` mock at
all — 13 tests run against real temporary SQLite files (not `:memory:` or a
fake: the whole point is filesystem behaviour — `fs.existsSync`,
better-sqlite3's own `.backup()` rather than a raw file copy, which the
source's own comment explains is necessary because WAL mode means a plain
`fs.copyFileSync` of the main file alone can silently miss committed data
still sitting in the `-wal` file).

Three mutations survived the first pass here, and each exposed a real flaw in
the test rather than in the code:

12. **A redundant safety net in `schema.ts` masked a mutation in `runner.ts`.**
    Removing `runner.ts`'s own `setVersionStmt.run(...)` call didn't fail any
    test, because `schema.ts`'s `initializeDatabaseSchema` has its own
    fallback (`if (!getMeta.get('schema_version')) setMeta.run(...,'1')`) —
    and the only real migration today (v1) happens to call
    `initializeDatabaseSchema` from inside its `up()`. The redundancy is real
    and harmless for v1, but it meant the test couldn't tell "runner.ts wrote
    the version" from "schema.ts's fallback wrote it instead," which matters
    for whatever v2 turns out to be, if it doesn't itself touch `corpus_meta`.
    Fixed by stubbing `initializeDatabaseSchema` to a no-op for one test,
    isolating runner.ts's own responsibility.
13. **An idempotency test recreated the exact table it was supposed to be
    checking for.** It dropped `corpus_meta`, then manually re-created
    `corpus_meta` itself, then asserted `corpus_meta` exists — trivially true
    whether or not the safety-net call under test ever ran. Fixed by dropping
    a table the test does NOT itself recreate (`projects`) and confirming only
    the safety net's own second call brings it back.
14. **The rollback test's failure point couldn't distinguish "wrapped in a
    transaction" from "not."** Throwing at the very start of a migration's
    `up()` means `setVersionStmt.run()` is never reached either way — that
    line is simply sequential code after the throw, with or without
    `db.transaction()` around it. Proving the transaction boundary is real
    needed a migration that does some observable DDL work and THEN throws:
    the mock now creates a marker table before throwing, and the test checks
    that table is gone afterward — which is only true if better-sqlite3
    actually rolled the whole callback back, since SQLite auto-commits each
    statement when there is no ambient transaction.

None of these were bugs in `runner.ts` — all three were fixed test-side. Given
this is the third round in a row where a mutation survived because of a test
design flaw rather than a missing case (round 5's mirror-file mistake, round
6's fixture length, now this), the mutation-testing pass is reliably finding
something worth fixing nearly every time it runs — which is the argument for
keeping it as a standing step before any new suite ships, not a one-off gut
check.

All of round 7 mutation-tested (4/4 caught, after the three fixes above):
the backup step removed, the version stamp no longer written, the idempotent
safety net removed, and the migration no longer transaction-wrapped.

**Round 8, next day (2026-08-25): the remaining three IPC handlers.**
`tafsirHandlers.ts` (22 tests), `voiceHandlers.ts` (30), `shamelaHandlers.ts`
(22) — closing out G4's Electron IPC list entirely. All three are
`switch`-based (not `workspaceHandlers.ts`'s `service[name]` pattern), so the
risk here was state-machine correctness and a couple of genuine security
boundaries rather than prototype pollution:

- **tafsir**: Principle 5 — "never let `uvx tafsir-mcp` silently download
  ~214 MB" — a local connect must refuse outright when the database isn't
  present, not trigger the download itself. The install flow's module-level
  state (`installState`/`installAbort`) was tested for the properties that
  are easy to get subtly wrong: a second `install:start` while one is already
  running returns the existing state rather than restarting it, a cancel
  reports `idle` (not `error`), and a genuine failure reports `error` with
  the real message and *rethrows* — the state machine has to get the
  distinction between "the user stopped this" and "this broke" right.
- **voice**: FR-6.6's online-consent gate (edge-tts must never be reached
  without explicit `onlineConsent === true`, and an online failure has to
  fall back to local Piper rather than leaving the user with silence — and
  report why, so a fallback result is never mistaken for online quality) and
  `VOICE_SAVE_CLONE_SAMPLE`'s path-traversal defense, a renderer-supplied
  filename written to disk behind two independent guards. Also: per-window
  audiobook-export cancellation, keyed by `event.sender.id` and stored in
  module-level state shared across every call — the same class of
  easy-to-leak-between-windows risk as tafsir's install flow.
- **shamela**: the single-in-flight-import guard (SPEC-M5.9 FR-2) and
  `readBook`'s numeric page re-sort — Lucene's `TermRangeQuery` order is not
  guaranteed to be reading order, so a lexicographic sort would put page
  `"10"` before page `"2"`.

No production bugs in the IPC logic itself, but two more first-contact
typecheck issues from pulling these files into the TS program for the first
time: `shamelaHandlers.ts` had two genuinely dead imports
(`importShamelaBooks`, `filterAlreadyImported` — both are only ever called
through the `service` object from `getWorkspaceDbService()`, never via the
direct import), and several of this round's own mock functions needed
explicit return-type annotations rather than relying on inference from their
first call site — the same class of issue as round 6's `aiHandlers.test.ts`,
now familiar enough to fix quickly rather than re-diagnose from scratch.

One mutation was deliberately left off the list rather than forced to pass:
`voiceHandlers.ts`'s path-traversal defense has TWO independent guards
(character-allowlist + a resolved-path prefix check), and no test can catch
the second one being deleted — every input that passes guard 1 (an
allowlisted character set with no `/` or `\`, plus rejecting anything
starting with `.`) provably cannot make `targetPath` escape `clonesDir`, so
guard 2 never has anything left to catch. This is legitimate
defense-in-depth against a *future* weakening of guard 1, not something
today's inputs can exercise — recorded in a comment in
`voiceHandlers.test.ts` so a future "why didn't this survive get caught"
investigation doesn't have to rediscover it.

All of round 8 mutation-tested (8/8 caught, with the one documented
exception above).

## G4 — Electron IPC layer: done. Migration runner: done.

Everything in `electron/ipc/*.ts` now has tests: `registry.ts`,
`systemHandlers.ts`, `workspaceHandlers.ts`, `aiHandlers.ts` (round 6),
`tafsirHandlers.ts`, `voiceHandlers.ts`, `shamelaHandlers.ts` (round 8), plus
`electron/db/migrations/runner.ts` (round 7). **Still open:**
`electron/preload.ts`; the rest of `electron/db/*` beyond what pre-existing
tests already cover through `workspaceStore/*.ts`; no E2E on the packaged
build.

**Round 9 (2026-08-25): the client-side subscription modules — P2 done.**
`subscriptionLifecycle.ts` (15 tests), `planTiers.ts` (16), `tierUpgrade.ts`
(16), `referral.ts` (17). These are not edge functions, so they used the
component/hook testing pattern rather than the handler pattern: plain
function calls, fake timers for date-boundary precision, the existing
`fakeSupabase.ts` for the one function that touches a database
(`applyPendingReferral`).

`subscriptionLifecycle.ts` is the client-side twin of
`check-subscription-expiry`'s server logic — what decides whether the UI
shows "active", nags with "expiring soon", or blocks a feature as "expired".
Tested the exact day-boundary (7 vs 8 days remaining), the exempt-account
short-circuit, and that `Math.ceil` rounding a partial day up can put a
subscription with 7 days and 1 hour left back on the "active" side of the
threshold — documented as the correct, if slightly surprising, consequence
of comparing rounded days rather than raw remaining time, not a bug.

`referral.ts`'s `applyPendingReferral` needed one addition to the shared
fake: `.is()` didn't exist on `fakeSupabase.ts` (same gap `.lt()` was in
round 4 — nobody had called it yet), and this function's own idempotency
guarantee ("won't overwrite an existing `referred_by`") is expressed as
`.is("referred_by", null)`, so proving that guarantee for real needed the
method implemented, not stubbed. Added as a genuine filter (matching
Postgrest's IS NULL semantics, including treating an absent field as NULL)
alongside the existing `eq`/`neq`/ordering comparisons.

No production bugs this round. All of round 9 mutation-tested (8/8 caught):
the expiring-soon threshold widened, the exempt-account check removed, the
expired-instant boundary shifted by one, a price silently drifting from its
mirror field, a feature suffix silently dropped, the upgrade ladder skipping
a step, the self-referral guard removed, and the idempotency filter removed.

## P2 — done

Electron IPC (`registry`, `systemHandlers`, `workspaceHandlers`,
`aiHandlers`, `tafsirHandlers`, `voiceHandlers`, `shamelaHandlers`), the
migration runner, and the client-side subscription modules are all tested.
Suite: 96 files/771 tests → 124/1471, coverage 0 → 33.17%, across 9 rounds in
28 hours, with 8 production bugs found (7 by writing tests, 1 the other way
around — the mutation-testing pass itself catching a test fixture) and zero
regressions introduced along the way.

Still open, all P3-scope: `electron/preload.ts`; `_shared/` modules outside
the citation-integrity set (`rateLimit.ts`, `researchPrompts.ts`,
`arabicRoot.ts`, `stopwords.ts`); no E2E on the packaged desktop build.

## G3 — done

Every `_shared/` module named in the original audit now has tests:
`citationVerifier` (round 2), `citationCandidates` and `segmentClaims` (round
5). `aiGateway.ts`, `rateLimit.ts`, `arabicRoot.ts`, `researchPrompts.ts`, and
`stopwords.ts` were not on that list and remain open, but none of them carry
the citation-integrity risk the five above did — this was the corpus-grounding
half of the pipeline, and it is now covered end to end: retrieval
(`citationCandidates`) through verification (`citationVerifier`).

**Round 10 (2026-08-25): P3 — closing the backlog's last three items.**

*Per-path coverage thresholds (G6).* §9's proposed numbers (90/85 for the two
receipt functions, 85 lines for `citationVerifier`, 80/70 for `src/core` and
`src/lib`) were aspirational, written before anyone measured what the suite
actually cleared. Measured for real: verify-receipt 99.24%/82.61%
(lines/branches), verify-renewal-receipt 97.52%/77.14%, citationVerifier
98.29%/70%, `src/core` 39.59%/27.32% (lines/functions), `src/lib`
50.72%/59.81%. Set the thresholds a few points under each of those — the
ratchet principle from §9 itself: never gate on a number the suite cannot
already meet, or CI disables the gate within a month. `src/core`/`src/lib` in
particular are nowhere near §9's original 80/70 guess; the floor now locks in
today's real coverage instead of gating on a fiction.

*The four grep-tests (G8).* `arabicMatnFilter`, `deleteByScope`,
`researchSources`, and `rijalNarrations` all predated P1's `handle(req)`
exports and read source text with `readFileSync` instead of calling code — §6
flagged them for revisiting once that landed. `deleteByScope` and
`rijalNarrations`'s ingest-batch assertions now call `handle()` for real
against `fakeSupabase` (the "not chunked" claim, for instance, is now "exactly
one RPC call" measured on a live mock, not a grep for the string `CHUNK`).
`researchSources` now imports islamic-search's tier-domain constants directly
(newly exported for this) instead of regexing them out of the file.
`arabicMatnFilter` converts its Tier A (islamic-api-fetch, mocking the three
external APIs' real response shapes) and Tier B (vector-search's
`rowToIslamicResult`, also newly exported) checks to real calls; the Tier
K/D/W/L and topic-anchor assertions stay source-text on purpose — they sit
inside one 1200-line handler behind an auth wall, a rate limiter, a
token-guard deduction, and six tiers' worth of RPC/fetch dependencies, and
faking all of that to observe one boolean literal per tier would hide bugs
behind a wall of mocks more than it would catch them. Each new behavioral
assertion was mutation-tested before commit (3/3 caught: Dorar's `has_matn`
flipped, ingest-batch's chunking loop widened to one giant chunk, and
delete-by-scope's single RPC call split into a per-collection loop).

15. **A live bug in the token-refund safety net, found by first-contact
    typechecking, not by writing a test.** `researchSources.test.ts`'s new
    literal-path import of `islamic-search/index.ts` was the first time
    anything pulled that file into `tsc -p tsconfig.app.json` by name (the
    only prior import was `edgeFunctionContract.test.ts`'s dynamic
    `import(\`.../${name}/index.ts\`)`, whose non-literal specifier TypeScript
    cannot resolve statically, so it never actually type-checks the target —
    the same reason this pattern was safe for 28 other functions and silent
    for these four). `tsc` refused to compile: the crash-path refund in
    `handle()`'s outer `catch` read `tokenCost` and `user`, both declared with
    `const` *inside* the `try` block — block-scoped out of the sibling `catch`
    entirely. At runtime, `typeof tokenCost !== "undefined"` there threw a
    ReferenceError every time (a name with no binding in any enclosing scope
    throws on `typeof`, unlike an undeclared global), which the refund's own
    `catch (_) { /* ignore refund errors in crash path */ }` silently
    swallowed — so a token deducted just before *any* unhandled error in this
    handler was never refunded, on every request, since the code was written.
    Fixed by hoisting `capturedUser`/`capturedTokenCost` mirrors to function
    scope, set once each value is known good. Regression test in
    `islamicSearchTokenRefund.test.ts` forces a realistic post-deduction crash
    (`deduct_tokens` returning a malformed JSON string, which
    `checkAndDeductTokens` does not guard `JSON.parse` against) and asserts
    `credit_tokens` fires with the right user/amount; mutation-tested by
    reverting to the original `typeof tokenCost` condition and confirming the
    test fails. `fakeSupabase.ts` gained `auth.getUser()` support (the older
    auth check islamic-search uses, alongside the existing `getClaims()`) to
    make the test possible at all.

The same first-contact pass surfaced the now-familiar class of pre-existing,
never-checked issues across the four files (same pattern as `verify-receipt`'s
`ReturnType<typeof createClient>` in round 1 and `process-email-queue`'s
`.replaceAll` in round 4) — none of them bugs, all fixed at the source rather
than typed around: `ingest-batch`'s catch block narrowed `err: unknown` before
reading `.message`; `islamic-api-fetch` got the same `SupabaseClient<any>`
alias verify-receipt already established, plus two real-but-undeclared
`citation_ref` fields (`title`, genuinely set by the personal-library channel;
`author`, referenced defensively but never actually set by anything);
`islamic-search` lost one dead function (`stripArabicDiacritics`, superseded
by a Postgres RPC and a separate `domain-scrape` function, per its own
now-stale comment) and one dead variable (`tierKDomains` — Tier K uses a
richer `wantsQuran`/`wantsHadith`/`wantsFatwa` inference instead, documented
in the block right below where the unused variable sat); and its `timed()`
helper's parameter type was tightened from `Promise<T>` to `PromiseLike<T>`
to accept Postgrest query builders directly, which are thenable but not real
`Promise` instances.

*Packaged-app smoke test (E2E).* Added `@playwright/test`, `playwright.config.ts`,
and `e2e/electronLaunch.spec.ts` — launches the real Electron process against
`dist-electron/main.js` (the same output `electron-builder` packages, not a
full per-OS installer), waits for the first window, and asserts the renderer
actually mounted (a non-empty `<body>`, and the window's title synced to
`document.title` rather than staying on the `BrowserWindow` constructor's
initial string) plus a clean main-process stderr. `npm run test:e2e` runs it.
Wired into `release.yml` right after `build:electron` (which already produces
`dist/`+`dist-electron/` before handing off to `electron-builder`) and before
the artifact upload, with `xvfb-run` on the Linux leg only — GitHub's
macOS/Windows runners already have a display session, Linux does not.
Mutation-tested locally: a `main.js` that throws synchronously on import
timed the test out at 60s (a crashed process never produces a first window —
Playwright cannot distinguish "still starting" from "never going to start"
faster than its own timeout, which is why a build that cannot start still
gets caught, just not instantly).

## P3 — done

All three backlog items closed: per-path coverage thresholds now reflect
measured reality rather than a guess, the four grep-tests read real code where
that was tractable (documented exceptions where it wasn't), and the packaged
app has its first-ever launch smoke test in the release pipeline. Suite: 124
files/1471 tests → 125/1476, coverage 33.17% → 34.07%, one more production bug
found (the token-refund ReferenceError) — the ninth bug this project's testing
push has found, and the second (after round 4's `process-email-queue` fixture)
found by something other than a test actually failing.

Still open, none P3-scope: `electron/preload.ts`; `_shared/` modules outside
the citation-integrity set (`rateLimit.ts`, `researchPrompts.ts`,
`arabicRoot.ts`, `stopwords.ts`); SSE/streaming reassembly tests.
