# ADR 0030 — Live-Model Eval Harness

**Status:** Accepted · **Date:** 2026-09-06 · **Milestone:** SPEC-M9 (Phase B)

## Context

The 27 agent test files all inject a scripted `ModelFn` — they prove the
**contract** (the loop feeds errors back, the ledger gates `insert_footnote`,
Ask mode blocks writes, a playbook's `bind` step forces one tool). None of them
tell us whether the **real model** makes good decisions: retrieve before it
cites, never invent a source, pick the right tool, honour a forced call, stop
when the job is done.

That gap is the blocker for ADR-0031 (multi-provider). Swapping Gemini for Groq
or DeepSeek is only safe if we can measure that the grounding and
tool-selection quality holds. So Phase B builds the measurement first.

## Decisions

**Swap exactly one thing — the ModelFn.** `src/test/fixtures/agentEval/world.ts`
gives every scenario a deterministic `DispatchFn`: fixed chapters, a fixed set
of retrievable chunks, canned `search_general`. The `RetrievalLedger` runs for
real, so `insert_footnote`'s integrity gate is the production one. A metric
change therefore means a **model** change, not a backend flake.

**A golden set as data.** `scenarios.ts` — 9 real tasks to start (cite a
hadith, answer in Ask mode, "what does the chapter say" → `search_corpus` not
`read_document`, no-source-no-invention, RTL layout, grounded `draft_section`,
don't-overwork, General-is-never-a-citation, the `add-verified-citations`
playbook). Each declares what a competent run must do. Grow the list over time.

**Scoring is pure and CI-tested.** `score.ts` turns `(scenario, AgentRunResult,
dispatchCalls)` into pass/fail + metrics: `citationResolveRate`,
`groundingViolations`, `steps`, tool-choice checks. `agentEvalScore.test.ts`
runs in CI (no network) and also drives `runAgentLoop` with a scripted model to
prove the plumbing.

**Env-gated, like `hostLive.test.ts`.** `describe.runIf(AGENT_EVAL_LIVE === '1'
&& GEMINI_API_KEY)`. `getDecryptedGeminiKey()` gained a `process.env.
GEMINI_API_KEY` fallback (BYOK still wins) so a headless run has a key.
`it.each` over the golden set, then one `it` asserting the aggregate meets
`baseline.json`. A JSON report lands in `test-results/`.

**Baseline is a committed floor, re-stamped deliberately.** `baseline.json`
ships with conservative thresholds, not the real Gemini numbers (I could not
run the paid eval). `AGENT_EVAL_WRITE_BASELINE=1` stamps the observed run;
thresholds are then tightened by hand. A Phase-C provider must clear this same
file to become selectable.

## First run (gemini-2.5-flash, 2026-09-06)

Run once for real. It immediately earned its keep:

- **A `keyStore` bug.** `getDecryptedGeminiKey` called `getKeyFilePath()`
  (→ Electron `app.getPath`) OUTSIDE the try/catch, so a headless context threw
  before reaching the env fallback. Every scenario errored at step 1 with zero
  API calls. Fixed (the Electron reach is now inside the guard).
- **Scenario sharpening.** `dont-overwork` phrased as "do X, and nothing else —
  no index, no typeset, no PDF" made the model do *nothing at all* (1 step). A
  real prompt-sensitivity finding, but too adversarial for a gate — softened to
  a plain "only cite the hadith". `draft-grounded-section`: without naming the
  tool, the model wrote the paragraph in chat instead of calling `draft_section`
  (the prose never reaches the doc) — a genuine gap; the scenario now names the
  tool and the comment records the workaround.
- **Playbook timeout.** A playbook bind step the model fills wrong falls through
  to the full free loop → 16 real calls → past 90s. Bumped the per-scenario
  timeout to 180s.

After those fixes: **9/9 pass, 100% citation-resolve, 0 grounding violations,
2.9 mean steps.** `baseline.json` thresholds are hand-set below that with margin
(an earlier run scored 63%), `maxGroundingViolations: 0` being the hard line.

## Consequences

- New: `src/test/fixtures/agentEval/{world,scenarios,score,baseline.json}.ts`,
  `src/test/agentEval.live.test.ts`, `src/test/agentEvalScore.test.ts`.
- `electron/ai/keyStore.ts` — env-var fallback in `getDecryptedGeminiKey`
  (guarded so a no-`app` context does not throw).
- Phase C swaps `modelFn` in the live test per provider; the scenarios and
  scoring are provider-agnostic already.
