# Testing Strategy

**Date:** 2026-08-24 · **Status:** P0 + P1 shipped & deployed 2026-08-24; P2–P3 proposed · **Related:** [SMOKE-TESTS.md](./SMOKE-TESTS.md), [QA-M5.md](./QA-M5.md)

§1 records the baseline as measured on 2026-08-24 and what it is now that P0 and
P1 have landed. Everything from §3 onward that is not marked ✅ is still a
proposal.

---

## 1. Where the suite stands

| Measure | Baseline | Now |
|---|---|---|
| Test files executed by `npm test` | 96 | **105** |
| Tests | 771 passed, 11 skipped | **1088 passed, 11 skipped, 0 failing** |
| Wall-clock (`npm test`) | 179.9 s | ~136 s (with 317 more tests) |
| Coverage number | **did not exist** | **29.65 % lines** (baseline was 25.45 %) |
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

> **Round 2 deployed 2026-08-24** (`dea6fb7`). `research-query` — the only
> function bundling `citationVerifier.ts` — redeployed and booting;
> `npm run smoke:functions` 29/29. No migrations. The apostrophe fix's *behaviour*
> is covered by unit tests, not yet observed against the live corpus: confirming
> it needs a research query that returns a Qur'an citation, and the bug was
> intermittent precisely because which apostrophe the model emits varies per run.

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

### G1 — The money path has no tests at all ✅ *closed for verify-receipt*

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

**Still open:** `check-subscription-expiry`, `reset-monthly-quotas`,
`process-email-queue`, and the client-side subscription modules
(`subscriptionLifecycle`, `planTiers`, `tierUpgrade`, `referral`).

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

### G3 — The `_shared/` modules that matter most are the untested ones ◐ *`citationVerifier` closed*

`citationVerifier.ts` — the safety net that drops hallucinated citations before
the client renders them — had no test, in a project where citation integrity has
already been a shipped bug class.

**Done:** 42 tests, mostly negative (nothing unverifiable survives), plus the
positive guarantee that the stored matn and `source_url` override whatever the
model wrote. Writing them found the apostrophe bug in §1. Still untested:
`aiGateway.ts`, `rateLimit.ts`, `citationCandidates.ts`, `segmentClaims.ts`,
`arabicRoot.ts`, `researchPrompts.ts`, `stopwords.ts`.

### G4 — Electron's security boundary is untested ◐ *`urlAllowlist` closed; IPC and db/ still open*

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
| P1 | `verify-renewal-receipt`, `check-subscription-expiry`, `reset-monthly-quotas` | G1 | 1 day |
| P2 | Electron IPC + migration-runner tests against temp SQLite | G4 | 1–2 days |
| P2 | SSE/streaming reassembly + abort tests | — | half day |
| P3 | Playwright `_electron` launch smoke in `release.yml` | E2E | 1 day |
| P3 | Replace the four grep-tests made redundant by P1 | G8 | 2 h |
| P3 | Per-path coverage thresholds, ratchet | G6 | 1 h |

P0 and P1 are done, including the `createClient` fake that was the blocker.

Three of the four bugs found so far were found *by writing the test*, not by
reading the code — the receiver short-fragment hole, `vector-search`'s silent
200, and the apostrophe class. That is the argument for continuing down the
backlog rather than declaring the coverage number good enough: each of those was
invisible to review and to the smoke script, and each was in a path where
failure is silent by construction.

Next, in order: the remaining subscription functions (`verify-renewal-receipt`
now shares its decision with `verify-receipt` but has none of its handler tests),
then `citationCandidates` and `segmentClaims`, then the Electron IPC and
migration-runner work in P2.
